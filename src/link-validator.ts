import { App, Notice, TFile, Modal, requestUrl } from 'obsidian';
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
    linkText: string;
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

        const actualTitles = new Map<number, string>();
        let foundFromNotes = 0;

        for (const workItemId of workItemIds) {
            const workItemFile = this.app.vault.getMarkdownFiles()
                .find(file => file.path.startsWith('Azure DevOps Work Items/') && 
                            file.name.startsWith(`WI-${workItemId} `));

            if (workItemFile) {
                try {
                    const content = await this.app.vault.read(workItemFile);

                    let extractedTitle = '';

                    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (frontmatterMatch) {
                        const frontmatter = frontmatterMatch[1];
                        const titleMatch = frontmatter.match(/^title:\s*["']?([^"'\n]+)["']?$/m);
                        if (titleMatch) {
                            extractedTitle = titleMatch[1].trim();
                        }
                    }

                    if (!extractedTitle) {
                        const afterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
                        const headingMatch = afterFrontmatter.match(/^# (.+)$/m);
                        if (headingMatch) {
                            const heading = headingMatch[1].trim();

                            if (!['Custom Fields', 'Description', 'Links', 'Details', 'Acceptance Criteria'].includes(heading)) {
                                extractedTitle = heading;
                            }
                        }
                    }

                    if (!extractedTitle) {
                        const fileNameMatch = workItemFile.name.match(/^WI-\d+\s+(.+)\.md$/);
                        if (fileNameMatch) {
                            extractedTitle = fileNameMatch[1].trim();
                        }
                    }

                    if (extractedTitle) {
                        actualTitles.set(workItemId, extractedTitle);
                    } else {
                        console.error(`Could not extract title for work item ${workItemId} from ${workItemFile.name}`);
                    }

                } catch (error) {
                    console.error(`Error reading file for work item ${workItemId}:`, error);
                }
            }
        }

        const idsToFetch = workItemIds.filter(id => !actualTitles.has(id));

        if (idsToFetch.length > 0) {
            await this.fetchWorkItemTitlesSmart(idsToFetch, actualTitles);
        }

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

        // Compare display text with actual titles
        let processedCount = 0;
        for (const [, links] of azureDevOpsLinks) {

            for (const link of links) {
                const actualTitle = actualTitles.get(link.workItemId);

                if (actualTitle && link.displayText !== actualTitle) {

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
                    console.warn(`No actual title found for work item ${link.workItemId} (404 or permission issue)`);
                }
            }

            processedCount++;
        }

        return invalidLinks;
    }

    async fetchWorkItemTitlesSmart(workItemIds: number[], actualTitles: Map<number, string>) {
        if (workItemIds.length === 0) return;

        const batchSizes = [50, 25, 10, 5];
        let remainingIds = [...workItemIds];

        for (const batchSize of batchSizes) {
            if (remainingIds.length === 0) break;

            const newRemainingIds: number[] = [];

            // Process in batches of current size
            for (let i = 0; i < remainingIds.length; i += batchSize) {
                const batch = remainingIds.slice(i, i + batchSize);

                try {
                    const workItems = await this.fetchWorkItemsBatch(batch);

                    if (workItems.length > 0) {
                        for (const workItem of workItems) {
                            const title = workItem.fields['System.Title'] || '';
                            actualTitles.set(workItem.id, title);
                        }

                        // Remove successfully fetched IDs from remaining
                        const fetchedIds = new Set(workItems.map(wi => wi.id));
                        const notFetched = batch.filter(id => !fetchedIds.has(id));
                        newRemainingIds.push(...notFetched);

                    } else {
                        // Batch failed, add all IDs back to remaining for smaller batch size
                        newRemainingIds.push(...batch);
                    }
                } catch (error) {
                    // Batch failed, add all IDs back to remaining
                    newRemainingIds.push(...batch);
                }

                // Add a small delay to avoid overwhelming the API
                if (i < remainingIds.length - batchSize) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            remainingIds = newRemainingIds;
        }

        if (remainingIds.length > 0) {

            for (const workItemId of remainingIds) {
                try {
                    const workItem = await this.fetchIndividualWorkItem(workItemId);
                    if (workItem) {
                        const title = workItem.fields['System.Title'] || '';
                        actualTitles.set(workItem.id, title);
                    }
                } catch (error) {
                    console.warn(`Could not fetch work item ${workItemId}:`, error.message);
                }

                // Small delay between individual requests
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }

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

    async fixInvalidLinks(validationResults: LinkValidationResult[]) {
        const loadingNotice = new Notice('🔧 Fixing invalid Azure DevOps links...', 0);

        try {
            const fileUpdates = new Map<string, FileUpdate>();

            // Collect all file updates needed
            for (let i = 0; i < validationResults.length; i++) {
                const result = validationResults[i];

                for (let j = 0; j < result.affectedFiles.length; j++) {
                    const filePath = result.affectedFiles[j];

                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (!(file instanceof TFile)) {
                        continue;
                    }

                    let fileUpdate = fileUpdates.get(filePath);
                    if (!fileUpdate) {
                        const oldContent = await this.app.vault.read(file);
                        fileUpdate = {
                            file,
                            oldContent,
                            newContent: oldContent
                        };
                        fileUpdates.set(filePath, fileUpdate);
                    }

                    const linkTextExists = fileUpdate.newContent.includes(result.currentTitle);

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

                        if (!wasUpdated) {
                            // Debug: Show what we're trying to replace
                            const oldLinkPattern = `[${this.escapeRegex(result.currentTitle)}](${this.escapeRegex(result.azureDevOpsUrl)})`;
                            console.warn(`  - 🔍 Trying to match pattern: ${oldLinkPattern}`);

                            // Check if the URL exists in the content
                            const urlExists = fileUpdate.newContent.includes(result.azureDevOpsUrl);
                            console.warn(`  - 🔍 URL exists in content: ${urlExists}`);
                        }
                    } else {
                        console.warn(`Link text "${result.currentTitle}" not found in ${filePath}`);
                    }
                }
            }

            // Apply all file updates
            let updatedCount = 0;
            for (const [filePath, fileUpdate] of fileUpdates) {
                if (fileUpdate.oldContent !== fileUpdate.newContent) {
                    try {
                        await this.app.vault.modify(fileUpdate.file, fileUpdate.newContent);
                        updatedCount++;
                    } catch (error) {
                        console.error(`Failed to update ${filePath}:`, error);
                    }
                    loadingNotice.setMessage(`🔧 Updated ${updatedCount} files...`);
                }
            }

            loadingNotice.hide();

            if (updatedCount > 0) {
                new Notice(`✅ Successfully updated ${validationResults.length} invalid Azure DevOps links in ${updatedCount} files!`);
            } else {
                new Notice('No files needed updating');
            }

        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error fixing links: ${error.message}`);
            console.error('Link fixing error:', error);
        }
    }

    updateAzureDevOpsLinkInContent(content: string, oldTitle: string, newTitle: string, workItemId: number, azureUrl: string): string {
        const escapedOldTitle = this.escapeRegex(oldTitle);
        const escapedUrl = this.escapeRegex(azureUrl);

        // Create regex pattern to match [oldTitle](azureUrl)
        const linkPattern = new RegExp(`\\[${escapedOldTitle}\\]\\(${escapedUrl}\\)`, 'g');

        // Create replacement string
        const newLinkPattern = `[${newTitle}](${azureUrl})`;

        // Perform replacement
        const updatedContent = content.replace(linkPattern, newLinkPattern);

        // Check if replacement worked
        const wasReplaced = content !== updatedContent;

        if (!wasReplaced) {
            // Try without escaping special characters in the title (in case escaping is wrong)
            const simplePattern = new RegExp(`\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\([^)]*${workItemId}[^)]*\\)`, 'g');

            const altMatches = content.match(simplePattern);
            if (altMatches) {
                const altResult = content.replace(simplePattern, newLinkPattern);
                if (altResult !== content) {
                    return altResult;
                }
            }

            // Try even more flexible pattern - match any link to this work item ID
            const flexiblePattern = new RegExp(`\\[[^\\]]*\\]\\([^)]*${workItemId}[^)]*\\)`, 'g');

            const flexMatches = content.match(flexiblePattern);
            if (flexMatches) {
                // For each match, check if it contains our old title
                let flexResult = content;
                flexMatches.forEach(match => {
                    if (match.includes(oldTitle)) {
                        flexResult = flexResult.replace(match, newLinkPattern);
                    }
                });

                if (flexResult !== content) {
                    return flexResult;
                }
            }

            console.error(`All patterns failed`);
        }

        return updatedContent;
    }

    escapeRegex(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

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
        contentEl.addClass('azure-devops-link-validation-modal');

        // Title
        contentEl.createEl('h2', { 
            text: 'Azure DevOps link validation results',
            cls: 'azure-devops-modal-title'
        });

        // Summary
        const summary = contentEl.createEl('p', { cls: 'azure-devops-modal-summary' });
        summary.textContent = 'Found ';
        const strongCount = summary.createEl('strong');
        strongCount.textContent = this.results.length.toString();
        summary.appendText(` invalid Azure DevOps link${this.results.length !== 1 ? 's' : ''} in description sections. Select which ones to update:`);

        // Select All / Deselect All controls
        const selectControls = contentEl.createDiv('azure-devops-select-controls');

        const selectAllBtn = selectControls.createEl('button', {
            text: 'Select all',
            cls: 'azure-devops-control-btn mod-secondary'
        });

        const deselectAllBtn = selectControls.createEl('button', {
            text: 'Deselect all', 
            cls: 'azure-devops-control-btn mod-secondary'
        });

        const selectedCount = selectControls.createEl('span', {
            cls: 'azure-devops-selected-count'
        });
        this.updateSelectedCount(selectedCount);

        // Results container
        const resultsContainer = contentEl.createDiv('azure-devops-results-container');

        // Display each validation result with checkbox
        this.results.forEach((result, index) => {
            const resultDiv = resultsContainer.createDiv('azure-devops-result-item');
            if (!this.selectedResults.has(result)) {
                resultDiv.addClass('azure-devops-result-item--unselected');
            }

            // Checkbox container
            const checkboxContainer = resultDiv.createDiv('azure-devops-checkbox-container');

            // Checkbox
            const checkbox = checkboxContainer.createEl('input', {
                type: 'checkbox',
                cls: 'azure-devops-checkbox'
            });
            checkbox.checked = this.selectedResults.has(result);

            // Content container
            const contentContainer = checkboxContainer.createDiv('azure-devops-content-container');

            // Work item info
            const workItemInfo = contentContainer.createEl('div', {
                cls: 'azure-devops-work-item-info'
            });
            workItemInfo.textContent = 'Work Item ';
            const workItemStrong = workItemInfo.createEl('strong');
            workItemStrong.textContent = result.workItemId.toString();

            // URL info
            contentContainer.createEl('div', {
                text: result.azureDevOpsUrl,
                cls: 'azure-devops-url-info'
            });

            // Title comparison
            const titleComparison = contentContainer.createEl('div', {
                cls: 'azure-devops-title-comparison'
            });

            const currentDiv = titleComparison.createEl('div', {
                cls: 'azure-devops-current-title'
            });
            currentDiv.createEl('span', {
                text: '❌ Current link text:',
                cls: 'azure-devops-error-text'
            });
            currentDiv.appendText(` "${result.currentTitle}"`);

            const correctDiv = titleComparison.createEl('div', {
                cls: 'azure-devops-correct-title'
            });
            correctDiv.createEl('span', {
                text: '✅ Correct title:',
                cls: 'azure-devops-success-text'
            });
            correctDiv.appendText(` "${result.actualTitle}"`);

            // Affected files
            const filesDiv = contentContainer.createEl('div', {
                cls: 'azure-devops-affected-files'
            });
            const filesStrong = filesDiv.createEl('strong');
            filesStrong.textContent = 'Affected files:';
            filesDiv.appendText(` ${result.affectedFiles.length}`);

            // Show first few file names
            if (result.affectedFiles.length > 0) {
                const filesList = filesDiv.createEl('ul', {
                    cls: 'azure-devops-files-list'
                });

                const filesToShow = result.affectedFiles.slice(0, 2);
                for (const filePath of filesToShow) {
                    const fileName = filePath.split('/').pop() || filePath;
                    filesList.createEl('li', {
                        text: fileName,
                        cls: 'azure-devops-file-item'
                    });
                }

                if (result.affectedFiles.length > 2) {
                    filesList.createEl('li', {
                        text: `... and ${result.affectedFiles.length - 2} more`,
                        cls: 'azure-devops-file-item azure-devops-file-item--more'
                    });
                }
            }

            // Checkbox event handler
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedResults.add(result);
                    resultDiv.removeClass('azure-devops-result-item--unselected');
                } else {
                    this.selectedResults.delete(result);
                    resultDiv.addClass('azure-devops-result-item--unselected');
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
        const buttonContainer = contentEl.createDiv('azure-devops-button-container');

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });

        // Fix selected button
        const fixBtn = buttonContainer.createEl('button', {
            cls: 'mod-cta'
        });
        
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
        const resultDivs = container.querySelectorAll('.azure-devops-result-item');

        checkboxes.forEach((checkbox, index) => {
            (checkbox as HTMLInputElement).checked = checked;
            const resultDiv = resultDivs[index] as HTMLElement;
            if (resultDiv) {
                if (checked) {
                    resultDiv.removeClass('azure-devops-result-item--unselected');
                } else {
                    resultDiv.addClass('azure-devops-result-item--unselected');
                }
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