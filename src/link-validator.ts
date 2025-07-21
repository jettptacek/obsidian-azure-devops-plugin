import { App, Notice, TFile, Modal, ButtonComponent, requestUrl } from 'obsidian';
import { AzureDevOpsAPI } from './api';
import { AzureDevOpsSettings } from './settings';

interface LinkValidationResult {
    workItemId: number;
    currentTitle: string;
    actualTitle: string;
    affectedFiles: string[];
    azureDevOpsUrl: string;
}

interface FileUpdate {
    file: TFile;
    oldContent: string;
    newContent: string;
}

interface AzureDevOpsLink {
    workItemId: number;
    displayText: string;
    fullUrl: string;
    linkText: string; // The full [text](url) part
}

export class AzureDevOpsLinkValidator {
    app: App;
    api: AzureDevOpsAPI;
    settings: AzureDevOpsSettings;
    plugin: any;

    constructor(app: App, api: AzureDevOpsAPI, settings: AzureDevOpsSettings, plugin: any) {
        this.app = app;
        this.api = api;
        this.settings = settings;
        this.plugin = plugin;
    }

    // Main command to validate all Azure DevOps links in descriptions
    async validateAllAzureDevOpsLinks() {
        const loadingNotice = new Notice('🔍 Scanning links... (0% complete)', 0);
        
        try {
            // Get all work item notes
            const workItemFiles = this.app.vault.getMarkdownFiles()
                .filter(file => file.path.startsWith('Azure DevOps Work Items/') && file.name.match(/^WI-\d+/));

            if (workItemFiles.length === 0) {
                loadingNotice.hide();
                new Notice('No Azure DevOps work item notes found');
                return;
            }

            loadingNotice.setMessage(`📖 Analyzing descriptions in ${workItemFiles.length} work item notes...`);

            // Extract all Azure DevOps links from description sections
            const azureDevOpsLinks = await this.extractAzureDevOpsLinksFromDescriptions(workItemFiles);
            
            if (azureDevOpsLinks.size === 0) {
                loadingNotice.hide();
                new Notice('No Azure DevOps work item links found in description sections');
                return;
            }

            loadingNotice.setMessage(`🔍 Validating ${azureDevOpsLinks.size} Azure DevOps links...`);

            // Validate each Azure DevOps link against actual work item titles
            const validationResults = await this.validateAzureDevOpsLinks(azureDevOpsLinks);

            loadingNotice.hide();

            if (validationResults.length === 0) {
                new Notice('✅ All Azure DevOps links in descriptions are up to date!');
                return;
            }

            // Show results in a modal
            new LinkValidationModal(this.app, validationResults, (results) => {
                this.fixInvalidLinks(results);
            }).open();

        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error validating links: ${error.message}`);
            console.error('Link validation error:', error);
        }
    }

    // Extract Azure DevOps links from description sections only
    async extractAzureDevOpsLinksFromDescriptions(files: TFile[]): Promise<Map<number, AzureDevOpsLink[]>> {
        const azureDevOpsLinks = new Map<number, AzureDevOpsLink[]>();

        for (const file of files) {
            try {
                const content = await this.app.vault.read(file);
                const links = this.extractAzureDevOpsLinksFromContent(content, file.path);
                
                if (links.length > 0) {
                    azureDevOpsLinks.set(this.getWorkItemIdFromFileName(file.name), links);
                }
            } catch (error) {
                console.error(`Error reading file ${file.path}:`, error);
            }
        }

        return azureDevOpsLinks;
    }

    // Extract Azure DevOps links from description section only
    extractAzureDevOpsLinksFromContent(content: string, filePath: string): AzureDevOpsLink[] {
        const links: AzureDevOpsLink[] = [];

        // Extract only the Description section
        const descriptionMatch = content.match(/## Description\s*\n\n([\s\S]*?)(?=\n## |---\n\*Last|$)/);
        if (!descriptionMatch) {
            return links; // No description section found
        }

        const descriptionContent = descriptionMatch[1];

        // Pattern to match Azure DevOps work item links
        // [Some Text](https://dev.azure.com/org/project/_workitems/edit/12345)
        const azureDevOpsLinkPattern = /\[([^\]]+)\]\((https:\/\/dev\.azure\.com\/[^\/]+\/[^\/]+\/_workitems\/edit\/(\d+)[^)]*)\)/g;
        
        let match;
        while ((match = azureDevOpsLinkPattern.exec(descriptionContent)) !== null) {
            const displayText = match[1].trim();
            const fullUrl = match[2];
            const workItemId = parseInt(match[3]);
            const linkText = match[0]; // The full [text](url) part

            // Skip if this is just a generic "Azure DevOps" link
            if (displayText.toLowerCase() === 'azure devops' || 
                displayText.toLowerCase() === 'view in azure devops' ||
                displayText.toLowerCase() === 'link') {
                continue;
            }

            links.push({
                workItemId,
                displayText,
                fullUrl,
                linkText
            });
        }

        return links;
    }

    // Get work item ID from filename (WI-12345 Title.md -> 12345)
    getWorkItemIdFromFileName(fileName: string): number {
        const match = fileName.match(/^WI-(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    // Validate Azure DevOps links against actual work item titles
    async validateAzureDevOpsLinks(azureDevOpsLinks: Map<number, AzureDevOpsLink[]>): Promise<LinkValidationResult[]> {
        const invalidLinks: LinkValidationResult[] = [];
        
        // Get all unique work item IDs referenced in links
        const referencedWorkItemIds = new Set<number>();
        for (const links of azureDevOpsLinks.values()) {
            for (const link of links) {
                referencedWorkItemIds.add(link.workItemId);
            }
        }

        const workItemIds = Array.from(referencedWorkItemIds);
        console.log('🔍 DEBUG: Found work item IDs to validate:', workItemIds.length, 'unique work items');

        // OPTIMIZATION 1: Check if we already have titles from existing notes
        const actualTitles = new Map<number, string>();
        let foundFromNotes = 0;

        // Try to get titles from existing work item notes first (much faster)
        for (const workItemId of workItemIds) {
            const workItemFile = this.app.vault.getMarkdownFiles()
                .find(file => file.path.startsWith('Azure DevOps Work Items/') && 
                            file.name.startsWith(`WI-${workItemId} `));
            
            if (workItemFile) {
                try {
                    const content = await this.app.vault.read(workItemFile);
                    
                    // IMPROVED: Multiple ways to extract the title, with fallbacks
                    let extractedTitle = '';
                    
                    // Method 1: Extract from frontmatter (most reliable)
                    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (frontmatterMatch) {
                        const frontmatter = frontmatterMatch[1];
                        const titleMatch = frontmatter.match(/^title:\s*["']?([^"'\n]+)["']?$/m);
                        if (titleMatch) {
                            extractedTitle = titleMatch[1].trim();
                        }
                    }
                    
                    // Method 2: If no frontmatter title, try the main heading (but be more specific)
                    if (!extractedTitle) {
                        // Look for the first H1 heading after frontmatter, but not section headers
                        const afterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
                        const headingMatch = afterFrontmatter.match(/^# (.+)$/m);
                        if (headingMatch) {
                            const heading = headingMatch[1].trim();
                            
                            // Skip if it looks like a section header instead of work item title
                            if (!['Custom Fields', 'Description', 'Links', 'Details', 'Acceptance Criteria'].includes(heading)) {
                                extractedTitle = heading;
                            }
                        }
                    }
                    
                    // Method 3: Extract title from filename as last resort
                    if (!extractedTitle) {
                        const fileNameMatch = workItemFile.name.match(/^WI-\d+\s+(.+)\.md$/);
                        if (fileNameMatch) {
                            extractedTitle = fileNameMatch[1].trim();
                        }
                    }
                    
                    if (extractedTitle) {
                        actualTitles.set(workItemId, extractedTitle);
                        foundFromNotes++;
                        console.log(`📝 Work item ${workItemId}: "${extractedTitle}" (from ${workItemFile.name})`);
                    } else {
                        console.log(`⚠️ Could not extract title for work item ${workItemId} from ${workItemFile.name}`);
                    }
                    
                } catch (error) {
                    console.log(`❌ Error reading file for work item ${workItemId}:`, error);
                }
            }
        }

        console.log(`✅ Found ${foundFromNotes} titles from existing notes (fast)`);
        
        // OPTIMIZATION 2: Only fetch from API the work items we don't have titles for
        const idsToFetch = workItemIds.filter(id => !actualTitles.has(id));
        console.log(`🔍 Need to fetch ${idsToFetch.length} work items from Azure DevOps API`);
        
        if (idsToFetch.length > 0) {
            // OPTIMIZATION 3: Use smart batching that handles failures gracefully
            await this.fetchWorkItemTitlesSmart(idsToFetch, actualTitles);
        }

        console.log(`🔍 DEBUG: Total actual titles collected: ${actualTitles.size} out of ${workItemIds.length}`);

        // OPTIMIZATION: Pre-build a map of links to their source files to avoid repeated searches
        console.log('🔍 Building link-to-file mapping...');
        const linkToFilesMap = new Map<string, string[]>();

        for (const [fileWorkItemId, links] of azureDevOpsLinks) {
            // Get the source file path for this work item
            const sourceFile = this.app.vault.getMarkdownFiles()
                .find(file => file.path.startsWith('Azure DevOps Work Items/') && 
                            file.name.match(new RegExp(`^WI-${fileWorkItemId}\\s`)));
            
            if (sourceFile) {
                const filePath = sourceFile.path;
                
                for (const link of links) {
                    // Create a unique key for this link
                    const linkKey = `${link.workItemId}:${link.linkText}`;
                    
                    if (!linkToFilesMap.has(linkKey)) {
                        linkToFilesMap.set(linkKey, []);
                    }
                    linkToFilesMap.get(linkKey)!.push(filePath);
                }
            }
        }

        console.log(`📊 Built mapping for ${linkToFilesMap.size} unique links`);

        // Compare display text with actual titles (now much faster)
        let processedCount = 0;
        for (const [fileWorkItemId, links] of azureDevOpsLinks) {
            console.log(`🔍 DEBUG: Processing links from file WI-${fileWorkItemId}: ${links.length} links`);
            
            for (const link of links) {
                const actualTitle = actualTitles.get(link.workItemId);
                
                console.log(`🔍 DEBUG: Comparing work item ${link.workItemId}:`);
                console.log(`  - Link text: "${link.displayText}"`);
                console.log(`  - Actual title: "${actualTitle}"`);
                console.log(`  - Match: ${link.displayText === actualTitle}`);
                
                if (actualTitle && link.displayText !== actualTitle) {
                    console.log(`🚨 DEBUG: MISMATCH FOUND for work item ${link.workItemId}!`);
                    
                    // Use pre-built mapping instead of searching files
                    const linkKey = `${link.workItemId}:${link.linkText}`;
                    const affectedFiles = linkToFilesMap.get(linkKey) || [];
                    
                    invalidLinks.push({
                        workItemId: link.workItemId,
                        currentTitle: link.displayText,
                        actualTitle: actualTitle,
                        affectedFiles,
                        azureDevOpsUrl: link.fullUrl
                    });
                } else if (!actualTitle) {
                    console.log(`⚠️ DEBUG: No actual title found for work item ${link.workItemId} (404 or permission issue)`);
                }
            }
            
            processedCount++;
            // Show progress for large numbers of files
            if (processedCount % 50 === 0 || processedCount === azureDevOpsLinks.size) {
                console.log(`📊 Processed ${processedCount}/${azureDevOpsLinks.size} files`);
            }
        }

        console.log(`🔍 DEBUG: Found ${invalidLinks.length} invalid links total`);
        return invalidLinks;
    }

    async fetchWorkItemTitlesSmart(workItemIds: number[], actualTitles: Map<number, string>) {
        if (workItemIds.length === 0) return;
        
        // OPTIMIZATION 4: Try progressively smaller batch sizes
        const batchSizes = [50, 25, 10, 5];
        let remainingIds = [...workItemIds];
        
        for (const batchSize of batchSizes) {
            if (remainingIds.length === 0) break;
            
            console.log(`🔍 Trying batch size ${batchSize} for ${remainingIds.length} remaining work items...`);
            
            const newRemainingIds: number[] = [];
            
            // Process in batches of current size
            for (let i = 0; i < remainingIds.length; i += batchSize) {
                const batch = remainingIds.slice(i, i + batchSize);
                
                try {
                    const workItems = await this.fetchWorkItemsBatch(batch);
                    
                    if (workItems.length > 0) {
                        // Success! Extract titles
                        for (const workItem of workItems) {
                            const title = workItem.fields['System.Title'] || '';
                            actualTitles.set(workItem.id, title);
                        }
                        
                        // Remove successfully fetched IDs from remaining
                        const fetchedIds = new Set(workItems.map(wi => wi.id));
                        const notFetched = batch.filter(id => !fetchedIds.has(id));
                        newRemainingIds.push(...notFetched);
                        
                        console.log(`✅ Batch succeeded: got ${workItems.length} titles, ${notFetched.length} still need fetching`);
                    } else {
                        // Batch failed, add all IDs back to remaining for smaller batch size
                        newRemainingIds.push(...batch);
                    }
                } catch (error) {
                    // Batch failed, add all IDs back to remaining
                    newRemainingIds.push(...batch);
                    console.log(`❌ Batch failed, will retry with smaller batches`);
                }
                
                // Add a small delay to avoid overwhelming the API
                if (i < remainingIds.length - batchSize) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            remainingIds = newRemainingIds;
            console.log(`📊 After batch size ${batchSize}: ${remainingIds.length} work items still need fetching`);
        }
        
        // OPTIMIZATION 5: Final fallback for stubborn individual items
        if (remainingIds.length > 0) {
            console.log(`🔍 Final attempt: fetching ${remainingIds.length} individual work items...`);
            
            for (const workItemId of remainingIds) {
                try {
                    const workItem = await this.fetchIndividualWorkItem(workItemId);
                    if (workItem) {
                        const title = workItem.fields['System.Title'] || '';
                        actualTitles.set(workItem.id, title);
                    }
                } catch (error) {
                    console.log(`❌ Could not fetch work item ${workItemId}:`, error.message);
                }
                
                // Small delay between individual requests
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }

    // Fetch work items in batch
    // Replace your fetchWorkItemsBatch method in link-validator.ts with this corrected version

    async fetchWorkItemsBatch(workItemIds: number[]): Promise<any[]> {
        if (workItemIds.length === 0) return [];

        // Use the same URL format as the working getSpecificWorkItem method
        const url = `https://dev.azure.com/${this.settings.organization}/${this.settings.project}/_apis/wit/workitems?ids=${workItemIds.join(',')}&api-version=7.0`;

        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`
                },
                throw: false
            });

            if (response.status >= 200 && response.status < 300) {
                return response.json.value || [];
            } else {
                console.error(`Failed to fetch work items: ${response.status}`);
                console.error('Response text:', response.text);
                return [];
            }
        } catch (error) {
            console.error('Error fetching work items:', error);
            return [];
        }
    }

    async fetchIndividualWorkItem(workItemId: number): Promise<any> {
        const url = `https://dev.azure.com/${this.settings.organization}/${this.settings.project}/_apis/wit/workitems/${workItemId}?api-version=7.0`;

        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`
                },
                throw: false
            });

            if (response.status >= 200 && response.status < 300) {
                return response.json;
            } else {
                return null;
            }
        } catch (error) {
            return null;
        }
    }

    // Fix invalid links by updating all affected files
    async fixInvalidLinks(validationResults: LinkValidationResult[]) {
        const loadingNotice = new Notice('🔧 Fixing invalid Azure DevOps links...', 0);
        
        console.log(`🔧 DEBUG: Starting to fix ${validationResults.length} validation results`);
        
        try {
            const fileUpdates = new Map<string, FileUpdate>();
            
            // Collect all file updates needed
            for (let i = 0; i < validationResults.length; i++) {
                const result = validationResults[i];
                console.log(`🔧 DEBUG: Processing result ${i + 1}/${validationResults.length}:`);
                console.log(`  - Work item: ${result.workItemId}`);
                console.log(`  - Current title: "${result.currentTitle}"`);
                console.log(`  - Actual title: "${result.actualTitle}"`);
                console.log(`  - Affected files: ${result.affectedFiles.length}`);
                
                for (let j = 0; j < result.affectedFiles.length; j++) {
                    const filePath = result.affectedFiles[j];
                    console.log(`  - Processing file ${j + 1}/${result.affectedFiles.length}: ${filePath}`);
                    
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (!(file instanceof TFile)) {
                        console.log(`  - ❌ File not found or not a TFile: ${filePath}`);
                        continue;
                    }
                    
                    let fileUpdate = fileUpdates.get(filePath);
                    if (!fileUpdate) {
                        console.log(`  - 📁 Creating new file update for: ${filePath}`);
                        const oldContent = await this.app.vault.read(file);
                        fileUpdate = {
                            file,
                            oldContent,
                            newContent: oldContent
                        };
                        fileUpdates.set(filePath, fileUpdate);
                    } else {
                        console.log(`  - 📁 Using existing file update for: ${filePath}`);
                    }
                    
                    // Log content before update
                    console.log(`  - 🔍 Looking for link text: "${result.currentTitle}"`);
                    const linkTextExists = fileUpdate.newContent.includes(result.currentTitle);
                    console.log(`  - 🔍 Link text exists in file: ${linkTextExists}`);
                    
                    if (linkTextExists) {
                        // Replace the link text in the description section
                        const beforeUpdate = fileUpdate.newContent;
                        fileUpdate.newContent = this.updateAzureDevOpsLinkInContent(
                            fileUpdate.newContent,
                            result.currentTitle,
                            result.actualTitle,
                            result.workItemId,
                            result.azureDevOpsUrl
                        );
                        
                        const wasUpdated = beforeUpdate !== fileUpdate.newContent;
                        console.log(`  - ✏️ Content was updated: ${wasUpdated}`);
                        
                        if (wasUpdated) {
                            console.log(`  - ✅ Successfully updated link in: ${filePath}`);
                        } else {
                            console.log(`  - ⚠️ No changes made to: ${filePath} (regex might not have matched)`);
                            
                            // Debug: Show what we're trying to replace
                            const oldLinkPattern = `[${this.escapeRegex(result.currentTitle)}](${this.escapeRegex(result.azureDevOpsUrl)})`;
                            console.log(`  - 🔍 Trying to match pattern: ${oldLinkPattern}`);
                            
                            // Check if the URL exists in the content
                            const urlExists = fileUpdate.newContent.includes(result.azureDevOpsUrl);
                            console.log(`  - 🔍 URL exists in content: ${urlExists}`);
                        }
                    } else {
                        console.log(`  - ⚠️ Link text "${result.currentTitle}" not found in ${filePath}`);
                    }
                }
            }

            console.log(`🔧 DEBUG: Total files to update: ${fileUpdates.size}`);
            
            // Apply all file updates
            let updatedCount = 0;
            for (const [filePath, fileUpdate] of fileUpdates) {
                console.log(`🔧 DEBUG: Checking if file needs update: ${filePath}`);
                console.log(`  - Content changed: ${fileUpdate.oldContent !== fileUpdate.newContent}`);
                
                if (fileUpdate.oldContent !== fileUpdate.newContent) {
                    console.log(`  - 💾 Updating file: ${filePath}`);
                    try {
                        await this.app.vault.modify(fileUpdate.file, fileUpdate.newContent);
                        updatedCount++;
                        console.log(`  - ✅ Successfully updated: ${filePath}`);
                    } catch (error) {
                        console.log(`  - ❌ Failed to update ${filePath}:`, error);
                    }
                    loadingNotice.setMessage(`🔧 Updated ${updatedCount} files...`);
                } else {
                    console.log(`  - ⏭️ No changes needed for: ${filePath}`);
                }
            }

            loadingNotice.hide();
            
            console.log(`🔧 DEBUG: Final results - Updated ${updatedCount} files out of ${fileUpdates.size} processed`);
            
            if (updatedCount > 0) {
                new Notice(`✅ Successfully updated ${validationResults.length} invalid Azure DevOps links in ${updatedCount} files!`);
                
                // Refresh tree view if it exists
                const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
                if (treeView && typeof treeView.refreshChangeDetection === 'function') {
                    console.log('🔧 DEBUG: Refreshing tree view after link validator changes...');
                    
                    // Just refresh the tree view - DON'T update the baseline
                    // This will detect the link validator changes as "pending changes" which is what we want
                    await treeView.refreshChangeDetection();
                }
            } else {
                new Notice('No files needed updating');
                console.log('🔧 DEBUG: No files were actually modified - check the debug logs above');
            }

        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error fixing links: ${error.message}`);
            console.error('Link fixing error:', error);
        }
    }

    // Update Azure DevOps link in content
    updateAzureDevOpsLinkInContent(content: string, oldTitle: string, newTitle: string, workItemId: number, azureUrl: string): string {
        console.log(`🔧 REGEX DEBUG: Updating link content`);
        console.log(`  - Old title: "${oldTitle}"`);
        console.log(`  - New title: "${newTitle}"`);
        console.log(`  - Azure URL: "${azureUrl}"`);
        
        // First, let's try a more flexible approach
        // Look for the exact link pattern: [oldTitle](azureUrl)
        
        // Escape special regex characters in both title and URL
        const escapedOldTitle = this.escapeRegex(oldTitle);
        const escapedUrl = this.escapeRegex(azureUrl);
        
        console.log(`  - Escaped old title: "${escapedOldTitle}"`);
        console.log(`  - Escaped URL: "${escapedUrl}"`);
        
        // Create regex pattern to match [oldTitle](azureUrl)
        const linkPattern = new RegExp(`\\[${escapedOldTitle}\\]\\(${escapedUrl}\\)`, 'g');
        
        console.log(`  - Regex pattern: ${linkPattern.source}`);
        
        // Test if the pattern matches
        const matches = content.match(linkPattern);
        console.log(`  - Pattern matches found: ${matches ? matches.length : 0}`);
        
        if (matches) {
            console.log(`  - Match examples:`, matches.slice(0, 3));
        }
        
        // Create replacement string
        const newLinkPattern = `[${newTitle}](${azureUrl})`;
        console.log(`  - Replacement pattern: "${newLinkPattern}"`);
        
        // Perform replacement
        const updatedContent = content.replace(linkPattern, newLinkPattern);
        
        // Check if replacement worked
        const wasReplaced = content !== updatedContent;
        console.log(`  - Replacement successful: ${wasReplaced}`);
        
        if (!wasReplaced) {
            // If the main pattern didn't work, try some alternative approaches
            console.log(`  - 🔍 Main pattern failed, trying alternatives...`);
            
            // Try without escaping special characters in the title (in case escaping is wrong)
            const simplePattern = new RegExp(`\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]*${workItemId}[^)]*\\)`, 'g');
            console.log(`  - Alternative pattern 1: ${simplePattern.source}`);
            
            const altMatches = content.match(simplePattern);
            if (altMatches) {
                console.log(`  - Alternative matches:`, altMatches.slice(0, 3));
                const altResult = content.replace(simplePattern, newLinkPattern);
                if (altResult !== content) {
                    console.log(`  - ✅ Alternative pattern worked!`);
                    return altResult;
                }
            }
            
            // Try even more flexible pattern - match any link to this work item ID
            const flexiblePattern = new RegExp(`\\[[^\\]]*\\]\\([^)]*${workItemId}[^)]*\\)`, 'g');
            console.log(`  - Flexible pattern: ${flexiblePattern.source}`);
            
            const flexMatches = content.match(flexiblePattern);
            if (flexMatches) {
                console.log(`  - Flexible matches:`, flexMatches.slice(0, 3));
                
                // For each match, check if it contains our old title
                let flexResult = content;
                flexMatches.forEach(match => {
                    if (match.includes(oldTitle)) {
                        console.log(`  - Replacing flexible match: ${match}`);
                        flexResult = flexResult.replace(match, newLinkPattern);
                    }
                });
                
                if (flexResult !== content) {
                    console.log(`  - ✅ Flexible pattern worked!`);
                    return flexResult;
                }
            }
            
            console.log(`  - ❌ All patterns failed`);
        }
        
        return updatedContent;
    }

    // Also improve the escapeRegex method to be more robust
    escapeRegex(text: string): string {
        // Escape all special regex characters
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

// Modal to show validation results
class LinkValidationModal extends Modal {
    results: LinkValidationResult[];
    onFix: (results: LinkValidationResult[]) => void;
    selectedResults: Set<LinkValidationResult> = new Set();

    constructor(app: App, results: LinkValidationResult[], onFix: (results: LinkValidationResult[]) => void) {
        super(app);
        this.results = results;
        this.onFix = onFix;
        // Start with all items selected by default
        this.selectedResults = new Set(results);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Title
        contentEl.createEl('h2', { text: 'Azure DevOps Link Validation Results' });
        
        // Summary
        const summary = contentEl.createEl('p');
        summary.innerHTML = `Found <strong>${this.results.length}</strong> invalid Azure DevOps link${this.results.length !== 1 ? 's' : ''} in description sections. Select which ones to update:`;

        // Select All / Deselect All controls
        const selectControls = contentEl.createDiv();
        selectControls.style.marginBottom = '15px';
        selectControls.style.display = 'flex';
        selectControls.style.gap = '10px';
        selectControls.style.alignItems = 'center';
        
        const selectAllBtn = selectControls.createEl('button');
        selectAllBtn.textContent = 'Select All';
        selectAllBtn.className = 'mod-secondary';
        selectAllBtn.style.fontSize = '12px';
        selectAllBtn.style.padding = '4px 8px';
        
        const deselectAllBtn = selectControls.createEl('button');
        deselectAllBtn.textContent = 'Deselect All';
        deselectAllBtn.className = 'mod-secondary';
        deselectAllBtn.style.fontSize = '12px';
        deselectAllBtn.style.padding = '4px 8px';
        
        const selectedCount = selectControls.createEl('span');
        selectedCount.style.marginLeft = '15px';
        selectedCount.style.fontSize = '12px';
        selectedCount.style.color = 'var(--text-muted)';
        this.updateSelectedCount(selectedCount);

        // Results container
        const resultsContainer = contentEl.createDiv();
        resultsContainer.style.maxHeight = '400px';
        resultsContainer.style.overflowY = 'auto';
        resultsContainer.style.border = '1px solid var(--background-modifier-border)';
        resultsContainer.style.borderRadius = '4px';
        resultsContainer.style.padding = '10px';
        resultsContainer.style.marginBottom = '20px';

        // Display each validation result with checkbox
        this.results.forEach((result, index) => {
            const resultDiv = resultsContainer.createDiv();
            resultDiv.style.marginBottom = '15px';
            resultDiv.style.padding = '10px';
            resultDiv.style.backgroundColor = 'var(--background-secondary)';
            resultDiv.style.borderRadius = '4px';
            resultDiv.style.position = 'relative';

            // Checkbox container
            const checkboxContainer = resultDiv.createDiv();
            checkboxContainer.style.display = 'flex';
            checkboxContainer.style.alignItems = 'flex-start';
            checkboxContainer.style.gap = '10px';
            checkboxContainer.style.marginBottom = '8px';

            // Checkbox
            const checkbox = checkboxContainer.createEl('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selectedResults.has(result);
            checkbox.style.marginTop = '2px';
            checkbox.style.flexShrink = '0';
            
            // Content container
            const contentContainer = checkboxContainer.createDiv();
            contentContainer.style.flexGrow = '1';

            // Work item info
            const workItemInfo = contentContainer.createEl('div');
            workItemInfo.innerHTML = `<strong>Work Item ${result.workItemId}</strong>`;

            // URL info
            const urlInfo = contentContainer.createEl('div');
            urlInfo.style.fontSize = '11px';
            urlInfo.style.color = 'var(--text-muted)';
            urlInfo.style.marginTop = '2px';
            urlInfo.textContent = result.azureDevOpsUrl;

            // Title comparison
            const titleComparison = contentContainer.createEl('div');
            titleComparison.style.fontFamily = 'monospace';
            titleComparison.style.fontSize = '12px';
            titleComparison.style.marginTop = '8px';
            
            const currentDiv = titleComparison.createEl('div');
            currentDiv.innerHTML = `<span style="color: var(--text-error);">❌ Current link text:</span> "${result.currentTitle}"`;
            
            const correctDiv = titleComparison.createEl('div');
            correctDiv.innerHTML = `<span style="color: var(--text-success);">✅ Correct title:</span> "${result.actualTitle}"`;

            // Affected files
            const filesDiv = contentContainer.createEl('div');
            filesDiv.style.marginTop = '8px';
            filesDiv.style.fontSize = '11px';
            filesDiv.style.color = 'var(--text-muted)';
            filesDiv.innerHTML = `<strong>Affected files:</strong> ${result.affectedFiles.length}`;
            
            // Show first few file names
            if (result.affectedFiles.length > 0) {
                const filesList = filesDiv.createEl('ul');
                filesList.style.marginLeft = '15px';
                filesList.style.marginTop = '2px';
                
                const filesToShow = result.affectedFiles.slice(0, 2);
                for (const filePath of filesToShow) {
                    const fileName = filePath.split('/').pop() || filePath;
                    const listItem = filesList.createEl('li');
                    listItem.textContent = fileName;
                    listItem.style.fontSize = '10px';
                }
                
                if (result.affectedFiles.length > 2) {
                    const moreItem = filesList.createEl('li');
                    moreItem.textContent = `... and ${result.affectedFiles.length - 2} more`;
                    moreItem.style.fontSize = '10px';
                    moreItem.style.fontStyle = 'italic';
                }
            }

            // Checkbox event handler
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedResults.add(result);
                    resultDiv.style.backgroundColor = 'var(--background-secondary)';
                } else {
                    this.selectedResults.delete(result);
                    resultDiv.style.backgroundColor = 'var(--background-modifier-border)';
                }
                this.updateSelectedCount(selectedCount);
                this.updateButtons();
            });

            // Click on result div to toggle checkbox
            resultDiv.addEventListener('click', (e) => {
                // Don't toggle if clicking directly on the checkbox
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });

            // Initial styling based on selection
            if (!this.selectedResults.has(result)) {
                resultDiv.style.backgroundColor = 'var(--background-modifier-border)';
            }
        });

        // Select All / Deselect All event handlers
        selectAllBtn.addEventListener('click', () => {
            this.selectedResults = new Set(this.results);
            this.updateAllCheckboxes(resultsContainer, true);
            this.updateSelectedCount(selectedCount);
            this.updateButtons();
        });

        deselectAllBtn.addEventListener('click', () => {
            this.selectedResults.clear();
            this.updateAllCheckboxes(resultsContainer, false);
            this.updateSelectedCount(selectedCount);
            this.updateButtons();
        });

        // Buttons
        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '15px';

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'mod-secondary';
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        // Fix selected button
        const fixBtn = buttonContainer.createEl('button');
        fixBtn.className = 'mod-cta';
        this.updateButtons = () => {
            const selectedCount = this.selectedResults.size;
            if (selectedCount === 0) {
                fixBtn.textContent = 'No Items Selected';
                fixBtn.disabled = true;
                fixBtn.className = 'mod-secondary';
            } else {
                fixBtn.textContent = `Fix ${selectedCount} Selected Link${selectedCount !== 1 ? 's' : ''}`;
                fixBtn.disabled = false;
                fixBtn.className = 'mod-cta';
            }
        };
        
        fixBtn.addEventListener('click', () => {
            if (this.selectedResults.size > 0) {
                this.close();
                this.onFix(Array.from(this.selectedResults));
            }
        });

        // Initial button state
        this.updateButtons();
    }

    updateSelectedCount(selectedCountEl: HTMLElement) {
        const selectedCount = this.selectedResults.size;
        const totalCount = this.results.length;
        selectedCountEl.textContent = `${selectedCount} of ${totalCount} selected`;
    }

    updateAllCheckboxes(container: HTMLElement, checked: boolean) {
        const checkboxes = container.querySelectorAll('input[type="checkbox"]');
        const resultDivs = container.querySelectorAll('div[style*="background-color"]');
        
        checkboxes.forEach((checkbox, index) => {
            (checkbox as HTMLInputElement).checked = checked;
            const resultDiv = resultDivs[index] as HTMLElement;
            if (resultDiv) {
                resultDiv.style.backgroundColor = checked ? 
                    'var(--background-secondary)' : 
                    'var(--background-modifier-border)';
            }
        });
    }

    updateButtons() {
        // This will be set in onOpen()
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}