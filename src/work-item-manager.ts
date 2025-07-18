import { App, Notice, TFile } from 'obsidian';
import { AzureDevOpsAPI } from './api';
import { AzureDevOpsSettings } from './settings';
import { marked } from 'marked';

// Use require for TurndownService to avoid TypeScript module issues
const TurndownService = require('turndown');
const turndownPluginGfm = require('turndown-plugin-gfm');

interface WorkItemUpdate {
    title?: string;
    description?: string;
    descriptionFormat?: string;
    state?: string;
    assignedTo?: string;
    priority?: number;
    tags?: string;
    customFields?: { [key: string]: any }; // NEW: Support for custom fields
    needsHtmlConversion?: boolean; // Flag for async HTML conversion
}

interface RelatedWorkItem {
    id: number;
    title: string;
    type: string;
}

export class WorkItemManager {
    app: App;
    api: AzureDevOpsAPI;
    settings: AzureDevOpsSettings;
    plugin: any; // NEW: Reference to main plugin for tree view access
    // Cache for related work item details to avoid repeated API calls
    private relatedItemsCache = new Map<number, RelatedWorkItem>();
    // HTML to Markdown converter
    private turndownService: any;
    
    constructor(app: App, api: AzureDevOpsAPI, settings: AzureDevOpsSettings, plugin: any) {
        this.app = app;
        this.api = api;
        this.settings = settings;
        this.plugin = plugin; // NEW: Store plugin reference
        
        // Initialize Turndown service for HTML to Markdown conversion
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            hr: '---',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
            fence: '```',
            emDelimiter: '*',
            strongDelimiter: '**',
            linkStyle: 'inlined',
            linkReferenceStyle: 'full'
        });
        
        // Configure Turndown service for Azure DevOps specific HTML handling
        this.configureTurndownService();
        
        // Add GitHub Flavored Markdown support (including tables)
        const gfm = turndownPluginGfm.gfm;
        this.turndownService.use(gfm);
        
        // Configure Marked for Markdown to HTML conversion
        marked.setOptions({
            gfm: true,
            breaks: false,
            pedantic: false
        });
    }

    // Configure Turndown service for Azure DevOps specific HTML handling (improved table handling)
    private configureTurndownService() {
        // Handle Azure DevOps specific elements with better spacing preservation
        this.turndownService.addRule('azureDevOpsDiv', {
            filter: 'div',
            replacement: function (content: string, node: any) {
                // Preserve spacing around div content
                return content ? '\n\n' + content + '\n\n' : '';
            }
        });
        
        // Handle nested lists better with proper spacing
        this.turndownService.addRule('nestedLists', {
            filter: ['ul', 'ol'],
            replacement: function (content: string, node: any) {
                const parent = node.parentNode;
                if (parent && parent.nodeName === 'LI') {
                    return '\n' + content;
                }
                return '\n\n' + content + '\n\n';
            }
        });
        
        // Handle line breaks in Azure DevOps content - preserve intentional breaks including in tables
        this.turndownService.addRule('lineBreaks', {
            filter: 'br',
            replacement: function (content: string, node: any) {
                // Check if we're inside a table cell
                let parent = node.parentNode;
                while (parent) {
                    if (parent.nodeName === 'TD' || parent.nodeName === 'TH') {
                        // Inside a table cell - preserve as <br> for proper table formatting
                        return '<br>';
                    }
                    parent = parent.parentNode;
                }
                
                // Outside table - check if this is a meaningful line break
                const nextSibling = node.nextSibling;
                
                // If it's between block elements, convert to double newline
                if (nextSibling && nextSibling.nodeType === 1 && 
                    ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(nextSibling.nodeName)) {
                    return '\n\n';
                }
                
                return '\n';
            }
        });
        
        // Handle paragraphs with proper spacing
        this.turndownService.addRule('paragraphs', {
            filter: 'p',
            replacement: function (content: string, node: any) {
                if (!content.trim()) return '';
                return '\n\n' + content + '\n\n';
            }
        });
        
        // Handle headers with consistent spacing
        this.turndownService.addRule('headers', {
            filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            replacement: function (content: string, node: any) {
                const level = parseInt(node.nodeName.charAt(1));
                const prefix = '#'.repeat(level);
                return '\n\n' + prefix + ' ' + content + '\n\n';
            }
        });
        
        // Handle code blocks with proper spacing
        this.turndownService.addRule('codeBlocks', {
            filter: function (node: any) {
                return node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
            },
            replacement: function (content: string, node: any) {
                const code = node.firstChild;
                const language = code.getAttribute('class')?.replace('language-', '') || '';
                return '\n\n```' + language + '\n' + code.textContent + '\n```\n\n';
            }
        });
        
        // Handle Azure DevOps tables with better formatting and alignment preservation
        this.turndownService.addRule('azureTables', {
            filter: 'table',
            replacement: function (content: string, node: any) {
                // Extract table structure and rebuild as markdown
                const rows = node.querySelectorAll('tr');
                if (rows.length === 0) return content;
                
                const tableRows: string[] = [];
                let alignments: string[] = [];
                
                // Process each row
                rows.forEach((row: any, rowIndex: number) => {
                    const cells = row.querySelectorAll('th, td');
                    const cellContents: string[] = [];
                    
                    cells.forEach((cell: any, cellIndex: number) => {
                        // Extract text content and preserve <br> tags
                        let cellContent = '';
                        
                        // Process child nodes to preserve <br> tags
                        for (let i = 0; i < cell.childNodes.length; i++) {
                            const child = cell.childNodes[i];
                            if (child.nodeType === 3) { // Text node
                                cellContent += child.textContent;
                            } else if (child.nodeName === 'BR') {
                                cellContent += '<br>';
                            } else {
                                cellContent += child.textContent || '';
                            }
                        }
                        
                        cellContents.push(cellContent.trim());
                        
                        // Extract alignment from first row (header)
                        if (rowIndex === 0) {
                            const style = cell.getAttribute('style') || '';
                            if (style.includes('text-align: center')) {
                                alignments[cellIndex] = 'center';
                            } else if (style.includes('text-align: right')) {
                                alignments[cellIndex] = 'right';
                            } else {
                                alignments[cellIndex] = 'left';
                            }
                        }
                    });
                    
                    // Build markdown row
                    if (cellContents.length > 0) {
                        tableRows.push('| ' + cellContents.join(' | ') + ' |');
                        
                        // Add separator row after header
                        if (rowIndex === 0) {
                            const separatorCells = alignments.map(align => {
                                switch (align) {
                                    case 'center': return ':---:';
                                    case 'right': return '---:';
                                    default: return '---';
                                }
                            });
                            tableRows.push('| ' + separatorCells.join(' | ') + ' |');
                        }
                    }
                });
                
                return '\n\n' + tableRows.join('\n') + '\n\n';
            }
        });
        
        // Handle blockquotes with proper spacing
        this.turndownService.addRule('blockquotes', {
            filter: 'blockquote',
            replacement: function (content: string) {
                const quotedContent = content.replace(/\n/g, '\n> ');
                return '\n\n> ' + quotedContent + '\n\n';
            }
        });
    }

    updateSettings(settings: AzureDevOpsSettings) {
        this.settings = settings;
    }

    // Pull work items to Obsidian notes
    async pullWorkItems() {
        // Show loading indicator
        const loadingNotice = new Notice('🔄 Pulling work items from Azure DevOps...', 0); // 0 = don't auto-hide
        
        try {
            const workItems = await this.api.getWorkItems();
            
            if (workItems.length === 0) {
                loadingNotice.hide();
                new Notice('No work items found in Azure DevOps');
                return;
            }

            // Update loading message with count
            loadingNotice.setMessage(`📥 Processing ${workItems.length} work items...`);

            const folderPath = 'Azure DevOps Work Items';
            
            // Create folder if it doesn't exist
            if (!await this.app.vault.adapter.exists(folderPath)) {
                await this.app.vault.createFolder(folderPath);
                console.log(`Created folder: ${folderPath}`);
            }

            let createdCount = 0;
            let updatedCount = 0;
            const totalItems = workItems.length;

            for (let index = 0; index < workItems.length; index++) {
                const workItem = workItems[index];
                
                // Update progress every 10 items or on last item
                if (index % 10 === 0 || index === totalItems - 1) {
                    const progress = Math.round(((index + 1) / totalItems) * 100);
                    loadingNotice.setMessage(`📝 Processing work items... ${progress}% (${index + 1}/${totalItems})`);
                }
                
                try {
                    const fields = workItem.fields;
                    const safeTitle = this.sanitizeFileName(fields['System.Title']);
                    const filename = `WI-${workItem.id} ${safeTitle}.md`;
                    const fullPath = `${folderPath}/${filename}`;

                    // Create note content
                    const content = await this.createWorkItemNote(workItem);

                    // Check if file already exists
                    if (await this.app.vault.adapter.exists(fullPath)) {
                        // Update existing file
                        const existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                        if (existingFile instanceof TFile) {
                            await this.app.vault.modify(existingFile, content);
                            updatedCount++;
                            console.log(`Updated: ${filename}`);
                        }
                    } else {
                        // Create new file
                        await this.app.vault.create(fullPath, content);
                        createdCount++;
                        console.log(`Created: ${filename}`);
                    }
                } catch (error) {
                    console.error(`Error processing work item ${workItem.id}:`, error);
                }
            }

            // Hide loading and show success
            loadingNotice.hide();
            new Notice(`✅ Pull complete: ${createdCount} created, ${updatedCount} updated`);
            
            // NEW: Refresh change detection in tree view if it exists
            const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
            if (treeView && typeof treeView.refreshChangeDetection === 'function') {
                await treeView.refreshChangeDetection();
            }
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Pull failed: ${error.message}`);
            console.error('Pull error:', error);
        }
    }

    // Push a specific work item file to Azure DevOps
    async pushSpecificWorkItem(file: TFile): Promise<boolean> {
        const loadingNotice = new Notice('🔄 Pushing to Azure DevOps...', 0);
        
        try {
            const content = await this.app.vault.read(file);
            
            // Parse frontmatter to get work item ID
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
                loadingNotice.hide();
                new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
                return false;
            }

            const frontmatter = frontmatterMatch[1];
            const idMatch = frontmatter.match(/id:\s*(\d+)/);
            
            if (!idMatch) {
                loadingNotice.hide();
                new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
                return false;
            }

            const workItemId = parseInt(idMatch[1]);
            loadingNotice.setMessage(`📤 Pushing work item ${workItemId}...`);

            // Extract updated values from frontmatter and content
            const updates = this.extractUpdatesFromNote(content, frontmatter);
            
            if (Object.keys(updates).length === 0) {
                loadingNotice.hide();
                new Notice('No changes detected to push');
                return false;
            }

            // Process any async HTML conversions needed
            const processedUpdates = await this.processDescriptionUpdates(updates);

            // Push updates to Azure DevOps
            const success = await this.api.updateWorkItem(workItemId, processedUpdates);
            
            if (success) {
                // Update the "Last pushed" timestamp in the note
                await this.updateNotePushTimestamp(file, content);
                loadingNotice.hide();
                new Notice(`✅ Work item ${workItemId} pushed successfully`);
                
                // NEW: Refresh change detection in tree view if it exists
                const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
                if (treeView && typeof treeView.refreshChangeDetection === 'function') {
                    await treeView.refreshChangeDetection();
                }
            } else {
                loadingNotice.hide();
            }
            
            return success;
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error pushing work item: ${error.message}`);
            return false;
        }
    }

    // Pull a specific work item from Azure DevOps
    async pullSpecificWorkItem(file: TFile): Promise<boolean> {
        const loadingNotice = new Notice('🔄 Pulling from Azure DevOps...', 0);
        
        try {
            const content = await this.app.vault.read(file);
            
            // Parse frontmatter to get work item ID
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
                loadingNotice.hide();
                new Notice('This note doesn\'t have frontmatter. Only work item notes can be pulled.');
                return false;
            }

            const frontmatter = frontmatterMatch[1];
            const idMatch = frontmatter.match(/id:\s*(\d+)/);
            
            if (!idMatch) {
                loadingNotice.hide();
                new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                return false;
            }

            const workItemId = parseInt(idMatch[1]);
            loadingNotice.setMessage(`📥 Pulling work item ${workItemId}...`);

            // Get the specific work item from Azure DevOps
            const workItem = await this.api.getSpecificWorkItem(workItemId);
            
            if (!workItem) {
                loadingNotice.hide();
                new Notice(`Failed to fetch work item ${workItemId} from Azure DevOps`);
                return false;
            }

            // Update the note with fresh data from Azure DevOps
            const updatedContent = await this.createWorkItemNote(workItem);
            await this.app.vault.modify(file, updatedContent);
            
            loadingNotice.hide();
            new Notice(`✅ Work item ${workItemId} pulled successfully`);
            
            // NEW: Update change detection for this specific item only
            const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
            if (treeView && typeof treeView.updateSpecificWorkItemChanges === 'function') {
                await treeView.updateSpecificWorkItemChanges(workItemId, file);
            }
            
            return true;
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error pulling work item: ${error.message}`);
            return false;
        }
    }

    // Push current work item note to Azure DevOps
    async pushCurrentWorkItem(): Promise<boolean> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file to push');
            return false;
        }

        return await this.pushSpecificWorkItem(activeFile);
    }

    // Fetch related work item details and cache them
    private async getRelatedWorkItemDetails(relatedId: number): Promise<RelatedWorkItem> {
        // Check cache first
        if (this.relatedItemsCache.has(relatedId)) {
            return this.relatedItemsCache.get(relatedId)!;
        }

        try {
            // Fetch from API
            const workItem = await this.api.getSpecificWorkItem(relatedId);
            if (workItem && workItem.fields) {
                const relatedItem: RelatedWorkItem = {
                    id: relatedId,
                    title: workItem.fields['System.Title'] || `Work Item ${relatedId}`,
                    type: workItem.fields['System.WorkItemType'] || 'Unknown'
                };
                
                // Cache the result
                this.relatedItemsCache.set(relatedId, relatedItem);
                return relatedItem;
            }
        } catch (error) {
            console.error(`Failed to fetch related work item ${relatedId}:`, error);
        }

        // Fallback if API call fails
        const fallback: RelatedWorkItem = {
            id: relatedId,
            title: `Work Item ${relatedId}`,
            type: 'Unknown'
        };
        this.relatedItemsCache.set(relatedId, fallback);
        return fallback;
    }

    // Create markdown content for a work item
    async createWorkItemNote(workItem: any): Promise<string> {
        const fields = workItem.fields;
        const id = workItem.id;
        
        // Get field values safely
        const title = fields['System.Title'] || 'Untitled';
        const workItemType = fields['System.WorkItemType'] || 'Unknown';
        const state = fields['System.State'] || 'Unknown';
        const assignedTo = fields['System.AssignedTo']?.displayName || 'Unassigned';
        const createdDate = fields['System.CreatedDate'] ? new Date(fields['System.CreatedDate']).toLocaleDateString() : 'Unknown';
        const changedDate = fields['System.ChangedDate'] ? new Date(fields['System.ChangedDate']).toLocaleDateString() : 'Unknown';
        
        // Handle description based on the actual format from Azure DevOps
        let description = 'No description provided';
        if (fields['System.Description']) {
            // Check if Azure DevOps indicates this field is in Markdown format
            const isMarkdownFormat = workItem.fieldFormats && 
                                   workItem.fieldFormats['System.Description'] && 
                                   workItem.fieldFormats['System.Description'].format === 'Markdown';
            
            if (isMarkdownFormat) {
                // Content is already in Markdown format
                description = fields['System.Description'];
            } else {
                // Content is in HTML format, convert to Markdown using Turndown
                description = this.htmlToMarkdown(fields['System.Description']);
            }
        }
        
        const tags = fields['System.Tags'] || '';
        const priority = fields['Microsoft.VSTS.Common.Priority'] || '';
        const areaPath = fields['System.AreaPath'] || '';
        const iterationPath = fields['System.IterationPath'] || '';

        // NEW: Extract custom fields
        const customFields = this.extractCustomFields(fields);
        const customFieldsYaml = this.formatCustomFieldsForYaml(customFields);
        const customFieldsMarkdown = this.formatCustomFieldsForMarkdown(customFields);

        // Process relationships to create all types of links
        const relations = workItem.relations || [];
        const parentLinks: string[] = [];
        const childLinks: string[] = [];
        const relatedLinks: string[] = [];
        const duplicateLinks: string[] = [];
        const dependencyLinks: string[] = [];
        const externalLinks: string[] = [];

        // Collect all related work item IDs first
        const relatedIds = new Set<number>();
        for (const relation of relations) {
            const relatedIdMatch = relation.url.match(/\/(\d+)$/);
            if (relatedIdMatch) {
                relatedIds.add(parseInt(relatedIdMatch[1]));
            }
        }

        // Batch fetch related work item details
        const relatedItemPromises = Array.from(relatedIds).map(id => 
            this.getRelatedWorkItemDetails(id)
        );
        await Promise.all(relatedItemPromises);

        // Process all relationships
        for (const relation of relations) {
            const comment = relation.attributes?.comment || '';
            
            // Handle work item relationships
            const relatedIdMatch = relation.url.match(/\/(\d+)$/);
            if (relatedIdMatch) {
                const relatedId = parseInt(relatedIdMatch[1]);
                const relatedItem = this.relatedItemsCache.get(relatedId);
                
                if (!relatedItem) continue;
                
                const sanitizedTitle = this.sanitizeFileName(relatedItem.title);
                const noteFilename = `WI-${relatedId} ${sanitizedTitle}`;
                const notePath = `[[${noteFilename}]]`;
                const azureUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${relatedId}`;
                const commentText = comment ? ` - *${comment}*` : '';
                
                switch (relation.rel) {
                    case 'System.LinkTypes.Hierarchy-Reverse':
                        parentLinks.push(`- **Parent:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Hierarchy-Forward':
                        childLinks.push(`- **Child:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Related':
                        relatedLinks.push(`- **Related:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Duplicate-Forward':
                        duplicateLinks.push(`- **Duplicate of:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Duplicate-Reverse':
                        duplicateLinks.push(`- **Duplicated by:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Dependency-Forward':
                        dependencyLinks.push(`- **Successor:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    case 'System.LinkTypes.Dependency-Reverse':
                        dependencyLinks.push(`- **Predecessor:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                    default:
                        // Handle other work item relationship types
                        const relType = this.formatRelationType(relation.rel);
                        relatedLinks.push(`- **${relType}:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                        break;
                }
            } else {
                // Handle external links (hyperlinks, attachments, etc.)
                const linkUrl = relation.url;
                const linkComment = relation.attributes?.comment || 'External Link';
                
                if (relation.rel === 'Hyperlink') {
                    externalLinks.push(`- **Link:** [${linkComment}](${linkUrl})`);
                } else if (relation.rel === 'AttachedFile') {
                    externalLinks.push(`- **Attachment:** [${linkComment}](${linkUrl})`);
                } else {
                    const relType = this.formatRelationType(relation.rel);
                    externalLinks.push(`- **${relType}:** [${linkComment}](${linkUrl})`);
                }
            }
        }

        // Create Azure DevOps URL
        const azureUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${id}`;

        const content = `---
id: ${id}
title: "${title}"
type: ${workItemType}
state: ${state}
assignedTo: ${assignedTo}
createdDate: ${createdDate}
changedDate: ${changedDate}
priority: ${priority}
areaPath: ${areaPath}
iterationPath: ${iterationPath}
tags: ${tags}
azureUrl: ${azureUrl}
synced: ${new Date().toISOString()}${customFieldsYaml}
---

# ${title}

**Work Item ID:** ${id}  
**Type:** ${workItemType}  
**State:** ${state}  
**Assigned To:** ${assignedTo}  
**Priority:** ${priority || 'Not set'}

## Details

**Created:** ${createdDate}  
**Last Changed:** ${changedDate}  
**Area Path:** ${areaPath}  
**Iteration:** ${iterationPath}  
**Tags:** ${tags || 'None'}

## Description

${description}

${customFieldsMarkdown}

## Links

[View in Azure DevOps](${azureUrl})

${parentLinks.length > 0 ? '\n' + parentLinks.join('\n') : ''}${childLinks.length > 0 ? '\n' + childLinks.join('\n') : ''}${relatedLinks.length > 0 ? '\n' + relatedLinks.join('\n') : ''}${duplicateLinks.length > 0 ? '\n' + duplicateLinks.join('\n') : ''}${dependencyLinks.length > 0 ? '\n' + dependencyLinks.join('\n') : ''}${externalLinks.length > 0 ? '\n' + externalLinks.join('\n') : ''}${parentLinks.length === 0 && childLinks.length === 0 && relatedLinks.length === 0 && duplicateLinks.length === 0 && dependencyLinks.length === 0 && externalLinks.length === 0 ? '\n\n*No additional links or relationships*' : ''}

---
*Last pulled: ${new Date().toLocaleString()}*
`;

        return content;
    }

    // Extract custom fields from Azure DevOps fields (optimized with better filtering)
    extractCustomFields(fields: any): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        // Pre-compiled regex for better performance
        const wefPattern = /^Wef\s+[0-9a-f]{32}/i;
        
        // Known system field prefixes to exclude
        const systemPrefixes = [
            'System.',
            'Microsoft.VSTS.',
            'Microsoft.TeamFoundation.',
            'WEF_',
            'Microsoft.Azure.',
            'Microsoft.Reporting.',
            'Microsoft.Build.',
            'Microsoft.Testing.'
        ];
        
        // Known system field patterns to exclude
        const systemPatterns = [
            /Kanban.*Column/i,
            /Board.*Column/i,
            /Board.*Lane/i,
            /System\.Extensionmarker/i,
            /\.ProcessedBy/i,
            /\.IsDeleted/i,
            /\.NodeName/i,
            /\.TreePath/i
        ];
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            // Skip null/undefined/empty values
            if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
                continue;
            }
            
            // Skip if it's a system field prefix
            if (systemPrefixes.some(prefix => fieldName.startsWith(prefix))) {
                continue;
            }
            
            // Skip if it matches system patterns
            if (systemPatterns.some(pattern => pattern.test(fieldName))) {
                continue;
            }
            
            // Skip WEF fields
            if (wefPattern.test(fieldName)) {
                continue;
            }
            
            // Skip fields that look like HTML or contain suspicious characters
            if (this.isFieldNameSuspicious(fieldName)) {
                continue;
            }
            
            // Only include fields that look like legitimate custom fields
            if (this.isLegitimateCustomField(fieldName)) {
                customFields[fieldName] = fieldValue; // Keep original field name
            }
        }
        
        return customFields;
    }

    // Check if a field name looks suspicious (contains HTML or invalid characters)
    private isFieldNameSuspicious(fieldName: string): boolean {
        // Check for HTML tags or entities
        if (/<[^>]+>/.test(fieldName) || /&[a-zA-Z0-9#]+;/.test(fieldName)) {
            return true;
        }
        
        // Check for table-related content
        if (fieldName.includes('<td>') || fieldName.includes('</td>') || 
            fieldName.includes('width=') || fieldName.includes('style=')) {
            return true;
        }
        
        // Check for excessive punctuation or special characters
        if (/[<>"'&\\\/]{2,}/.test(fieldName)) {
            return true;
        }
        
        // Check if it's mostly non-alphanumeric characters
        const alphanumericCount = (fieldName.match(/[a-zA-Z0-9]/g) || []).length;
        if (alphanumericCount < fieldName.length * 0.5) {
            return true;
        }
        
        return false;
    }

    // Check if a field name looks like a legitimate custom field
    private isLegitimateCustomField(fieldName: string): boolean {
        // Must contain at least some letters
        if (!/[a-zA-Z]/.test(fieldName)) {
            return false;
        }
        
        // Should look like a proper field name pattern
        // Examples: "Custom.MyField", "Company.ProjectField", "MyCustomField"
        const validPatterns = [
            /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/, // Namespace.Field
            /^[A-Za-z][A-Za-z0-9_\s]*$/, // Simple field name
            /^[A-Za-z][A-Za-z0-9_\-\s\.]*[A-Za-z0-9]$/ // More complex but reasonable
        ];
        
        return validPatterns.some(pattern => pattern.test(fieldName));
    }

    // Clean up custom field names for YAML and display
    cleanCustomFieldName(fieldName: string): string {
        return fieldName
            .replace(/^(Custom\.|MyCompany\.|Custom_)/i, '') // Remove common prefixes
            .replace(/[^a-zA-Z0-9_]/g, '_') // Replace special chars with underscore
            .replace(/_{2,}/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .toLowerCase();
    }

    // Format custom fields for YAML frontmatter (improved)
    formatCustomFieldsForYaml(customFields: { [key: string]: any }): string {
        if (Object.keys(customFields).length === 0) {
            return '';
        }
        
        let yaml = '\n# Custom Fields';
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
            // Create a safe YAML key from the field name
            const yamlKey = this.createSafeYamlKey(fieldName);
            
            // Handle different value types safely
            const yamlValue = this.formatValueForYaml(fieldValue);
            yaml += `\n${yamlKey}: ${yamlValue}`;
        }
        return yaml;
    }

    // Create a safe YAML key from field name
    private createSafeYamlKey(fieldName: string): string {
        // For YAML, we need a clean key but we'll store the original mapping
        return fieldName
            .replace(/[^a-zA-Z0-9_\.]/g, '_') // Replace invalid chars with underscore
            .replace(/_{2,}/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .toLowerCase();
    }

    // Format value safely for YAML
    private formatValueForYaml(fieldValue: any): string {
        if (typeof fieldValue === 'string') {
            // For very long strings or complex HTML, use YAML literal block scalar
            if (fieldValue.length > 200 || fieldValue.includes('<') || fieldValue.includes('\n')) {
                // Use YAML literal block scalar (|) for complex content
                const lines = fieldValue.split('\n');
                if (lines.length > 1 || fieldValue.includes('<')) {
                    // Multi-line or HTML content - use literal block
                    return '|\n  ' + fieldValue.replace(/\n/g, '\n  ');
                }
            }
            
            // Regular string - escape quotes and handle basic cases
            const escaped = fieldValue.replace(/"/g, '\\"').replace(/\n/g, '\\n');
            return `"${escaped}"`;
        } else if (typeof fieldValue === 'number') {
            return String(fieldValue);
        } else if (typeof fieldValue === 'boolean') {
            return String(fieldValue);
        } else if (fieldValue && typeof fieldValue === 'object') {
            // Handle complex objects (like person fields)
            if (fieldValue.displayName) {
                return `"${fieldValue.displayName.replace(/"/g, '\\"')}"`;
            } else {
                const jsonStr = JSON.stringify(fieldValue).replace(/"/g, '\\"');
                return `"${jsonStr}"`;
            }
        } else {
            return `"${String(fieldValue).replace(/"/g, '\\"')}"`;
        }
    }

    // Format custom fields for markdown display
    formatCustomFieldsForMarkdown(customFields: { [key: string]: any }): string {
        if (Object.keys(customFields).length === 0) {
            return '';
        }
        
        let markdown = '\n## Custom Fields\n\n';
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
            const displayName = this.formatFieldNameForDisplay(fieldName);
            let displayValue = '';
            
            if (typeof fieldValue === 'object' && fieldValue !== null) {
                if (fieldValue.displayName) {
                    displayValue = fieldValue.displayName;
                } else {
                    displayValue = JSON.stringify(fieldValue, null, 2);
                }
            } else {
                displayValue = String(fieldValue);
            }
            
            markdown += `**${displayName}:** ${displayValue}  \n`;
        }
        return markdown;
    }

    // Format field names for display
    formatFieldNameForDisplay(fieldName: string): string {
        return fieldName
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    // Helper method to format relation types for display
    private formatRelationType(relationType: string): string {
        // Handle common Azure DevOps relation types
        const typeMap: { [key: string]: string } = {
            'System.LinkTypes.Related': 'Related',
            'System.LinkTypes.Duplicate-Forward': 'Duplicate of',
            'System.LinkTypes.Duplicate-Reverse': 'Duplicated by',
            'System.LinkTypes.Dependency-Forward': 'Successor',
            'System.LinkTypes.Dependency-Reverse': 'Predecessor',
            'System.LinkTypes.Hierarchy-Forward': 'Child',
            'System.LinkTypes.Hierarchy-Reverse': 'Parent',
            'Microsoft.VSTS.TestCase.SharedStepReferencedBy': 'Referenced by Test Case',
            'Microsoft.VSTS.TestCase.SharedStepReferencedBy-Reverse': 'References Shared Step',
            'Microsoft.VSTS.Common.TestedBy': 'Tested by',
            'Microsoft.VSTS.Common.TestedBy-Reverse': 'Tests',
            'Hyperlink': 'Hyperlink',
            'AttachedFile': 'Attachment'
        };

        // Return mapped type or clean up the original
        if (typeMap[relationType]) {
            return typeMap[relationType];
        }

        // Clean up system types
        return relationType
            .replace(/^System\.LinkTypes\./, '')
            .replace(/^Microsoft\.VSTS\./, '')
            .replace(/-Forward$/, ' (Forward)')
            .replace(/-Reverse$/, ' (Reverse)')
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }

    // Clear the cache when settings are updated (in case of different project)
    clearRelatedItemsCache() {
        this.relatedItemsCache.clear();
    }

    // Extract updates from note content and frontmatter
    extractUpdatesFromNote(content: string, frontmatter: string): WorkItemUpdate {
        const updates: WorkItemUpdate = {};

        // Parse frontmatter into key-value pairs with better handling of complex values
        const frontmatterData: { [key: string]: string } = {};
        const lines = frontmatter.split('\n');
        
        let currentKey = '';
        let currentValue = '';
        let inLiteralBlock = false;
        
        for (const line of lines) {
            // Handle YAML literal block scalars (|)
            if (line.match(/^([^:]+):\s*\|$/)) {
                const match = line.match(/^([^:]+):\s*\|$/);
                if (match) {
                    currentKey = match[1].trim();
                    currentValue = '';
                    inLiteralBlock = true;
                    continue;
                }
            }
            
            // If we're in a literal block, collect indented content
            if (inLiteralBlock) {
                if (line.startsWith('  ')) {
                    currentValue += (currentValue ? '\n' : '') + line.substring(2);
                    continue;
                } else {
                    // End of literal block
                    frontmatterData[currentKey] = currentValue;
                    inLiteralBlock = false;
                    currentKey = '';
                    currentValue = '';
                    // Fall through to process current line normally
                }
            }
            
            // Regular key-value parsing
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                
                // Skip if this starts a literal block
                if (value === '|') {
                    currentKey = key;
                    currentValue = '';
                    inLiteralBlock = true;
                    continue;
                }
                
                // Remove quotes if present
                value = value.replace(/^["']|["']$/g, '');
                frontmatterData[key] = value;
            }
        }
        
        // Handle any remaining literal block
        if (inLiteralBlock && currentKey) {
            frontmatterData[currentKey] = currentValue;
        }

        // Extract title from markdown header - but only from the main title, not section headers
        const titleMatch = content.match(/^---\n[\s\S]*?\n---\n\n# (.+)$/m);
        if (titleMatch) {
            const newTitle = titleMatch[1].trim();
            const frontmatterTitle = frontmatterData.title?.replace(/^["']|["']$/g, '');
            if (newTitle !== frontmatterTitle) {
                updates.title = newTitle;
            }
        } else {
            // Fallback: look for the first # header after frontmatter, but make sure it's not a section header
            const afterFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');
            const firstHeaderMatch = afterFrontmatter.match(/^# (.+)$/m);
            if (firstHeaderMatch) {
                const potentialTitle = firstHeaderMatch[1].trim();
                // Skip if this looks like a section header
                if (!['Details', 'Description', 'Custom Fields', 'Links'].includes(potentialTitle)) {
                    const frontmatterTitle = frontmatterData.title?.replace(/^["']|["']$/g, '');
                    if (potentialTitle !== frontmatterTitle) {
                        updates.title = potentialTitle;
                    }
                }
            }
        }

        // Extract values from parsed frontmatter
        if (frontmatterData.state && frontmatterData.state !== '') {
            updates.state = frontmatterData.state;
        }

        if (frontmatterData.assignedTo && frontmatterData.assignedTo !== 'Unassigned') {
            updates.assignedTo = frontmatterData.assignedTo;
        }

        if (frontmatterData.priority && frontmatterData.priority !== '' && frontmatterData.priority !== 'null') {
            const priorityNum = parseInt(frontmatterData.priority);
            if (!isNaN(priorityNum)) {
                updates.priority = priorityNum;
            }
        }

        if (frontmatterData.tags !== undefined) {
            let tagValue = frontmatterData.tags;
            if (tagValue && tagValue !== 'None') {
                updates.tags = tagValue;
            } else {
                updates.tags = ''; // Explicitly set empty to clear tags in Azure DevOps
            }
        }

        // Extract custom fields from frontmatter
        const customFieldUpdates = this.extractCustomFieldUpdates(frontmatterData);
        if (Object.keys(customFieldUpdates).length > 0) {
            updates.customFields = customFieldUpdates;
        }

        // Extract description from Description section
        const descriptionMatch = content.match(/## Description\n\n([\s\S]*?)(?=\n## |---\n\*Last|$)/);
        if (descriptionMatch) {
            const markdownDescription = descriptionMatch[1].trim();
            
            if (this.settings.useMarkdownInAzureDevOps) {
                // Use native Markdown - no conversion needed
                updates.description = markdownDescription;
                updates.descriptionFormat = 'Markdown';
            } else {
                // Convert markdown to HTML for Azure DevOps using Marked
                updates.description = markdownDescription;
                updates.descriptionFormat = 'HTML';
                updates.needsHtmlConversion = true; // Flag for async conversion
            }
        }

        // Extract custom fields from Custom Fields section
        const customFieldsMatch = content.match(/## Custom Fields\n\n([\s\S]*?)(?=\n## |---\n\*Last|$)/);
        if (customFieldsMatch) {
            const customFieldsFromMarkdown = this.parseCustomFieldsFromMarkdown(customFieldsMatch[1]);
            if (Object.keys(customFieldsFromMarkdown).length > 0) {
                updates.customFields = { ...updates.customFields, ...customFieldsFromMarkdown };
            }
        }

        return updates;
    }

    // Extract custom field updates from frontmatter (improved for complex values)
    extractCustomFieldUpdates(frontmatterData: { [key: string]: string }): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        // Skip standard fields and look for custom fields
        const standardFields = new Set([
            'id', 'title', 'type', 'state', 'assignedto', 'assignedTo', 
            'createddate', 'createdDate', 'changeddate', 'changedDate',
            'priority', 'areapath', 'areaPath', 'iterationpath', 'iterationPath', 
            'tags', 'azureurl', 'azureUrl', 'synced'
        ]);
        
        // Process frontmatter looking for custom fields
        let currentKey = '';
        let currentValue = '';
        let inLiteralBlock = false;
        
        const lines = Object.entries(frontmatterData);
        for (const [key, value] of lines) {
            const lowerKey = key.toLowerCase();
            
            // Skip standard fields, comments (starting with #), and empty values
            if (standardFields.has(lowerKey) || key.startsWith('#')) {
                continue;
            }
            
            // Check if this starts a literal block
            if (value === '|' || value.startsWith('|\n')) {
                currentKey = key;
                currentValue = value.startsWith('|\n') ? value.substring(2) : '';
                inLiteralBlock = true;
                continue;
            }
            
            // If we're in a literal block, accumulate the value
            if (inLiteralBlock && key.startsWith('  ')) {
                currentValue += (currentValue ? '\n' : '') + key.substring(2);
                continue;
            }
            
            // End of literal block
            if (inLiteralBlock) {
                if (currentKey && !this.isFieldNameSuspicious(currentKey)) {
                    const originalFieldName = this.findOriginalFieldName(currentKey);
                    if (originalFieldName) {
                        customFields[originalFieldName] = currentValue;
                    }
                }
                inLiteralBlock = false;
                currentKey = '';
                currentValue = '';
            }
            
            // Regular field processing
            if (value !== '' && value !== 'null' && value !== 'undefined') {
                // Skip if the key looks suspicious
                if (this.isFieldNameSuspicious(key)) {
                    continue;
                }
                
                // For frontmatter fields, we need to map back to the original Azure field name
                const originalFieldName = this.findOriginalFieldName(key);
                if (originalFieldName) {
                    customFields[originalFieldName] = this.parseFieldValue(value);
                }
            }
        }
        
        // Handle any remaining literal block
        if (inLiteralBlock && currentKey) {
            if (!this.isFieldNameSuspicious(currentKey)) {
                const originalFieldName = this.findOriginalFieldName(currentKey);
                if (originalFieldName) {
                    customFields[originalFieldName] = currentValue;
                }
            }
        }
        
        return customFields;
    }

    // Find original Azure DevOps field name from YAML key
    private findOriginalFieldName(yamlKey: string): string | null {
        // This is tricky because we need to reverse the transformation
        // For now, let's be conservative and only handle fields we can confidently map back
        
        // If it already looks like a proper Azure field name, use it
        if (yamlKey.includes('.') && this.isLegitimateCustomField(yamlKey)) {
            return yamlKey;
        }
        
        // Try common custom field patterns
        const commonPrefixes = ['Custom', 'Company', 'Project', 'Team'];
        for (const prefix of commonPrefixes) {
            const candidate = `${prefix}.${yamlKey.charAt(0).toUpperCase() + yamlKey.slice(1)}`;
            if (this.isLegitimateCustomField(candidate)) {
                return candidate;
            }
        }
        
        // If we can't confidently map it back, skip it to avoid errors
        console.warn(`Cannot map YAML key '${yamlKey}' back to Azure DevOps field name`);
        return null;
    }

    // Parse custom fields from markdown section (improved)
    parseCustomFieldsFromMarkdown(markdownContent: string): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        // Parse lines like "**Field Name:** Field Value"
        const fieldLines = markdownContent.split('\n').filter(line => line.trim().length > 0);
        
        for (const line of fieldLines) {
            const match = line.match(/\*\*([^*]+):\*\*\s*(.+)/);
            if (match) {
                const fieldDisplayName = match[1].trim();
                const fieldValue = match[2].trim();
                
                // Skip if the field name looks suspicious
                if (this.isFieldNameSuspicious(fieldDisplayName)) {
                    continue;
                }
                
                // Try to map back to original field name
                const originalFieldName = this.findOriginalFieldNameFromDisplay(fieldDisplayName);
                if (originalFieldName) {
                    customFields[originalFieldName] = this.parseFieldValue(fieldValue);
                }
            }
        }
        
        return customFields;
    }

    // Find original field name from display name
    private findOriginalFieldNameFromDisplay(displayName: string): string | null {
        // Convert display name back to field name format
        const fieldName = displayName.toLowerCase().replace(/\s+/g, '_');
        
        // Skip if it looks suspicious
        if (this.isFieldNameSuspicious(fieldName)) {
            return null;
        }
        
        return this.findOriginalFieldName(fieldName);
    }

    // Convert cleaned field name back to Azure DevOps format
    convertToAzureFieldName(cleanedName: string): string {
        // First, check if this might be a known field that was incorrectly processed
        const knownFieldMappings: { [key: string]: string } = {
            'title': 'System.Title',
            'description': 'System.Description',
            'state': 'System.State',
            'assignedto': 'System.AssignedTo',
            'priority': 'Microsoft.VSTS.Common.Priority',
            'tags': 'System.Tags',
            'areapath': 'System.AreaPath',
            'iterationpath': 'System.IterationPath'
        };
        
        const lowerName = cleanedName.toLowerCase();
        if (knownFieldMappings[lowerName]) {
            console.warn(`Warning: Field '${cleanedName}' matches system field, but was processed as custom field`);
            return knownFieldMappings[lowerName];
        }
        
        // For actual custom fields, try to reconstruct the original name
        // This is a best-effort conversion based on common patterns
        
        // If it already looks like a proper field name, use it as-is
        if (cleanedName.includes('.')) {
            return cleanedName;
        }
        
        // Convert snake_case back to proper casing for Custom fields
        if (cleanedName.includes('_')) {
            const words = cleanedName.split('_');
            const pascalCase = words.map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join('');
            return `Custom.${pascalCase}`;
        }
        
        // Single word custom field
        return `Custom.${cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1)}`;
    }

    // Parse field value with appropriate type conversion (improved for complex values)
    parseFieldValue(value: string): any {
        // Handle empty or null values
        if (!value || value === 'null' || value === 'undefined') {
            return '';
        }
        
        // For very short values, try type conversion
        if (value.length < 50) {
            // Try to parse as number
            if (/^\d+$/.test(value)) {
                return parseInt(value);
            }
            
            // Try to parse as decimal
            if (/^\d+\.\d+$/.test(value)) {
                return parseFloat(value);
            }
            
            // Try to parse as boolean
            if (value.toLowerCase() === 'true') {
                return true;
            }
            if (value.toLowerCase() === 'false') {
                return false;
            }
        }
        
        // For longer values or complex content, preserve as string
        // Handle YAML literal block scalars (content that starts with |)
        if (value.startsWith('|\n')) {
            // Remove the YAML literal scalar indicator and unindent
            return value.substring(2).replace(/\n  /g, '\n').trim();
        }
        
        // Return as string, preserving original formatting
        return value;
    }

    // New method to handle async HTML conversion
    async processDescriptionUpdates(updates: WorkItemUpdate): Promise<WorkItemUpdate> {
        if (updates.needsHtmlConversion && updates.description) {
            updates.description = await this.markdownToHtml(updates.description);
            delete updates.needsHtmlConversion;
        }
        return updates;
    }

    // Update the note with last pushed timestamp
    async updateNotePushTimestamp(file: TFile, content: string) {
        const timestamp = new Date().toLocaleString();
        
        // Replace any existing "Last pulled" or "Last pushed" line with new "Last pushed"
        let updatedContent = content
            .replace(/\*Last pulled: .*\*/g, `*Last pushed: ${timestamp}*`)
            .replace(/\*Last pushed: .*\*/g, `*Last pushed: ${timestamp}*`);

        // If no timestamp line exists, add it at the end
        if (updatedContent === content) {
            // Check if there's already a final separator line
            if (content.endsWith('---') || content.includes('*Last')) {
                updatedContent = content.replace(/---\s*$/, '') + `\n\n---\n*Last pushed: ${timestamp}*`;
            } else {
                updatedContent = content + `\n\n---\n*Last pushed: ${timestamp}*`;
            }
        }

        await this.app.vault.modify(file, updatedContent);
    }

    // Sanitize filename for file system
    sanitizeFileName(title: string): string {
        if (!title) return 'Untitled';
        
        // Remove or replace invalid characters
        return title
            .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid chars with dash
            .replace(/\s+/g, ' ')           // Normalize whitespace
            .trim()                         // Remove leading/trailing spaces
            .substring(0, 100);             // Limit length
    }

    // Convert Markdown to HTML for Azure DevOps using custom table processing
    async markdownToHtml(markdown: string): Promise<string> {
        if (!markdown) return '';
        
        try {
            // First, process tables with our custom handler to ensure proper alignment
            let processedMarkdown = this.preProcessTablesForMarked(markdown);
            
            // Configure marked for better spacing preservation
            marked.setOptions({
                gfm: true,
                breaks: true,  // Convert line breaks to <br>
                pedantic: false
            });
            
            // Use marked to convert markdown to HTML
            let html = await marked(processedMarkdown);
            
            // Clean up and improve the HTML for Azure DevOps compatibility
            html = html
                // Preserve double line breaks as proper paragraph spacing
                .replace(/<\/p>\s*<p>/g, '</p>\n\n<p>')
                
                // Improve list formatting for Azure DevOps
                .replace(/<ul>\s*<li>/g, '<ul>\n<li>')
                .replace(/<\/li>\s*<li>/g, '</li>\n<li>')
                .replace(/<\/li>\s*<\/ul>/g, '</li>\n</ul>')
                .replace(/<ol>\s*<li>/g, '<ol>\n<li>')
                .replace(/<\/li>\s*<\/ol>/g, '</li>\n</ol>')
                
                // Add proper spacing around headers
                .replace(/<h([1-6])>/g, '\n<h$1>')
                .replace(/<\/h([1-6])>/g, '</h$1>\n')
                
                // Add spacing around code blocks
                .replace(/<pre>/g, '\n<pre>')
                .replace(/<\/pre>/g, '</pre>\n')
                
                // Preserve spacing around blockquotes
                .replace(/<blockquote>/g, '\n<blockquote>')
                .replace(/<\/blockquote>/g, '</blockquote>\n')
                
                // Clean up excessive whitespace while preserving intentional spacing
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            
            return html;
        } catch (error) {
            console.error('Error converting markdown to HTML:', error);
            // Fallback to improved manual conversion
            return this.fallbackMarkdownToHtml(markdown);
        }
    }

    // Pre-process markdown to replace tables with HTML before marked processes them
    private preProcessTablesForMarked(markdown: string): string {
        const lines = markdown.split('\n');
        const result: string[] = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i];
            
            // Check if this line starts a table
            if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
                // Look ahead to see if the next line is a separator
                const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
                
                if (nextLine.includes('|') && nextLine.includes('-')) {
                    // This is a markdown table, process it with our custom handler
                    const tableResult = this.processMarkdownTable(lines, i);
                    result.push(tableResult.html);
                    i = tableResult.nextIndex;
                    continue;
                }
            }
            
            // Not a table line, add as-is
            result.push(line);
            i++;
        }
        
        return result.join('\n');
    }

    // Convert HTML to Markdown when pulling from Azure DevOps using Turndown (improved preservation)
    htmlToMarkdown(html: string): string {
        if (!html) return '';
        
        try {
            // Clean up Azure DevOps HTML before conversion
            const cleanedHtml = html
                // Remove Azure DevOps specific attributes but preserve structure
                .replace(/\s*data-[\w-]+="[^"]*"/g, '')
                .replace(/\s*style="[^"]*"/g, '')
                .replace(/\s*class="[^"]*"/g, '')
                
                // Remove empty paragraphs
                .replace(/<p>\s*<\/p>/g, '')
                .replace(/<p><\/p>/g, '')
                
                // Fix malformed HTML
                .replace(/<br\s*\/?>/gi, '<br>')
                
                // Preserve intentional spacing in lists
                .replace(/(<\/li>)\s*(<li>)/g, '$1\n$2')
                .replace(/(<ul>)\s*(<li>)/g, '$1\n$2')
                .replace(/(<\/li>)\s*(<\/ul>)/g, '$1\n$2')
                .replace(/(<ol>)\s*(<li>)/g, '$1\n$2')
                .replace(/(<\/li>)\s*(<\/ol>)/g, '$1\n$2')
                
                // Remove script and style tags
                .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '');
            
            // Configure Turndown for better spacing preservation
            this.turndownService.options.blankReplacement = function (content: string, node: any) {
                return node.isBlock ? '\n\n' : '';
            };
            
            // Convert using Turndown
            let markdown = this.turndownService.turndown(cleanedHtml);
            
            // Post-process the markdown for better formatting and spacing preservation
            markdown = markdown
                // Preserve double line breaks for paragraph spacing
                .replace(/\n\n\n+/g, '\n\n')
                
                // Fix list spacing to match original markdown
                .replace(/(\n- [^\n]*)\n([^-\s])/g, '$1\n\n$2')  // Add spacing after lists
                .replace(/(\n\d+\. [^\n]*)\n([^0-9\s])/g, '$1\n\n$2')  // Add spacing after numbered lists
                
                // Ensure proper spacing around headers
                .replace(/\n(#{1,6} [^\n]*)\n([^#\n])/g, '\n$1\n\n$2')
                .replace(/([^\n])\n(#{1,6} [^\n]*)/g, '$1\n\n$2')
                
                // Ensure proper spacing around code blocks
                .replace(/\n```([^`][\s\S]*?)```\n([^\n])/g, '\n```$1```\n\n$2')
                .replace(/([^\n])\n```([^`][\s\S]*?)```/g, '$1\n\n```$2```')
                
                // Fix table spacing
                .replace(/\n(\|[^\n]*\|)\n([^|\n])/g, '\n$1\n\n$2')
                .replace(/([^|\n])\n(\|[^\n]*\|)/g, '$1\n\n$2')
                
                // Clean up excessive blank lines but preserve intentional double spacing
                .replace(/\n{4,}/g, '\n\n\n')  // Max 3 line breaks (2 blank lines)
                
                // Trim whitespace
                .trim();
            
            return markdown;
        } catch (error) {
            console.error('Error converting HTML to markdown:', error);
            // Fallback to original manual conversion if turndown fails
            return this.fallbackHtmlToMarkdown(html);
        }
    }

    // Fallback manual conversion for Markdown to HTML (improved spacing preservation)
    private fallbackMarkdownToHtml(markdown: string): string {
        if (!markdown) return '';
        
        let html = markdown;
        
        // Handle markdown tables with proper parsing first
        html = this.convertMarkdownTablesToHtml(html);
        
        // Process line by line to preserve spacing
        const lines = html.split('\n');
        const processedLines: string[] = [];
        let inCodeBlock = false;
        let codeBlockLang = '';
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            // Handle code blocks
            if (line.startsWith('```')) {
                if (inCodeBlock) {
                    processedLines.push('</code></pre>');
                    inCodeBlock = false;
                } else {
                    codeBlockLang = line.substring(3).trim();
                    processedLines.push(`<pre><code${codeBlockLang ? ` class="language-${codeBlockLang}"` : ''}>`);
                    inCodeBlock = true;
                }
                continue;
            }
            
            if (inCodeBlock) {
                processedLines.push(line);
                continue;
            }
            
            // Headers
            if (line.match(/^#{1,6} /)) {
                const level = line.match(/^#+/)?.[0].length || 1;
                const text = line.replace(/^#+\s*/, '').trim();
                processedLines.push(`<h${level}>${text}</h${level}>`);
                continue;
            }
            
            // Empty lines - preserve as spacing
            if (line.trim() === '') {
                processedLines.push('');
                continue;
            }
            
            // Lists
            if (line.match(/^\s*[\*\-\+] /)) {
                const indent = line.match(/^\s*/)?.[0].length || 0;
                const content = line.replace(/^\s*[\*\-\+]\s*/, '');
                const processed = this.processInlineMarkdown(content);
                
                // Check if we need to start/end list
                const prevLine = i > 0 ? lines[i - 1] : '';
                const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
                
                let listItem = `<li>${processed}</li>`;
                
                if (!prevLine.match(/^\s*[\*\-\+] /)) {
                    listItem = '<ul>\n' + listItem;
                }
                if (!nextLine.match(/^\s*[\*\-\+] /)) {
                    listItem = listItem + '\n</ul>';
                }
                
                processedLines.push(listItem);
                continue;
            }
            
            // Numbered lists
            if (line.match(/^\s*\d+\. /)) {
                const content = line.replace(/^\s*\d+\.\s*/, '');
                const processed = this.processInlineMarkdown(content);
                
                const prevLine = i > 0 ? lines[i - 1] : '';
                const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
                
                let listItem = `<li>${processed}</li>`;
                
                if (!prevLine.match(/^\s*\d+\. /)) {
                    listItem = '<ol>\n' + listItem;
                }
                if (!nextLine.match(/^\s*\d+\. /)) {
                    listItem = listItem + '\n</ol>';
                }
                
                processedLines.push(listItem);
                continue;
            }
            
            // Regular paragraphs
            if (line.trim() !== '') {
                const processed = this.processInlineMarkdown(line);
                
                // Check if this should be wrapped in <p> tags
                const prevLine = i > 0 ? lines[i - 1] : '';
                const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
                
                // Don't wrap if it's adjacent to block elements
                if (prevLine.trim() === '' && nextLine.trim() === '') {
                    processedLines.push(`<p>${processed}</p>`);
                } else if (prevLine.trim() === '') {
                    processedLines.push(`<p>${processed}`);
                } else if (nextLine.trim() === '') {
                    processedLines.push(`${processed}</p>`);
                } else {
                    processedLines.push(processed);
                }
            }
        }
        
        return processedLines.join('\n')
            .replace(/\n{3,}/g, '\n\n')  // Clean up excessive line breaks
            .trim();
    }

    // Process inline markdown elements
    private processInlineMarkdown(text: string): string {
        return text
            // Remove backslash escapes from common characters
            .replace(/\\(\[|\])/g, '$1')
            .replace(/\\([*_`])/g, '$1')
            
            // Bold and italic (order matters)
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            
            // Inline code
            .replace(/`(.*?)`/g, '<code>$1</code>')
            
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            
            // Images
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    }

    // Convert markdown tables to clean HTML tables
    private convertMarkdownTablesToHtml(markdown: string): string {
        // Split content into lines for table processing
        const lines = markdown.split('\n');
        const result: string[] = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i];
            
            // Check if this line starts a table (contains pipes and isn't just text)
            if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
                // Look ahead to see if the next line is a separator (contains dashes)
                const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
                
                if (nextLine.includes('|') && nextLine.includes('-')) {
                    // This is a markdown table, process it
                    const tableResult = this.processMarkdownTable(lines, i);
                    result.push(tableResult.html);
                    i = tableResult.nextIndex;
                    continue;
                }
            }
            
            // Not a table line, add as-is
            result.push(line);
            i++;
        }
        
        return result.join('\n');
    }

    // Process a complete markdown table starting at the given index (improved sizing and styling)
    private processMarkdownTable(lines: string[], startIndex: number): { html: string; nextIndex: number } {
        const tableLines: string[] = [];
        let currentIndex = startIndex;
        
        // Collect all table lines
        while (currentIndex < lines.length) {
            const line = lines[currentIndex];
            if (line.includes('|') && line.trim() !== '') {
                tableLines.push(line);
                currentIndex++;
            } else {
                break;
            }
        }
        
        if (tableLines.length < 2) {
            // Not a valid table, return original lines
            return {
                html: tableLines.join('\n'),
                nextIndex: currentIndex
            };
        }
        
        // Parse table structure
        const headerLine = tableLines[0];
        const separatorLine = tableLines[1];
        const dataLines = tableLines.slice(2);
        
        // Validate separator line
        if (!separatorLine.includes('-')) {
            return {
                html: tableLines.join('\n'),
                nextIndex: currentIndex
            };
        }
        
        // Parse header
        const headerCells = this.parseTableRow(headerLine);
        if (headerCells.length === 0) {
            return {
                html: tableLines.join('\n'),
                nextIndex: currentIndex
            };
        }
        
        // Parse alignment from separator
        const alignments = this.parseTableAlignment(separatorLine, headerCells.length);
        
        // Build HTML table with auto-sizing and consistent styling
        let tableHtml = '<table border="1" style="border-collapse: collapse; border: 1px solid #ccc; table-layout: auto;">\n';
        
        // Add header with proper alignment styling
        tableHtml += '  <thead>\n    <tr>\n';
        headerCells.forEach((cell, index) => {
            const alignment = alignments[index] || 'left';
            const alignStyle = alignment !== 'left' ? ` text-align: ${alignment};` : '';
            // Process cell content for inline markdown and br tags
            const processedCell = this.processTableCellContent(cell);
            tableHtml += `      <th style="border: 1px solid #ccc; padding: 8px; background-color: #f5f5f5; white-space: nowrap;${alignStyle}">${processedCell}</th>\n`;
        });
        tableHtml += '    </tr>\n  </thead>\n';
        
        // Add body with proper alignment styling
        if (dataLines.length > 0) {
            tableHtml += '  <tbody>\n';
            dataLines.forEach(line => {
                const cells = this.parseTableRow(line);
                if (cells.length > 0) {
                    tableHtml += '    <tr>\n';
                    // Ensure we have enough cells (pad with empty if needed)
                    const paddedCells = [...cells];
                    while (paddedCells.length < headerCells.length) {
                        paddedCells.push('');
                    }
                    
                    paddedCells.slice(0, headerCells.length).forEach((cell, index) => {
                        const alignment = alignments[index] || 'left';
                        const alignStyle = alignment !== 'left' ? ` text-align: ${alignment};` : '';
                        // Process cell content for inline markdown and br tags
                        const processedCell = this.processTableCellContent(cell);
                        tableHtml += `      <td style="border: 1px solid #ccc; padding: 8px; vertical-align: top;${alignStyle}">${processedCell}</td>\n`;
                    });
                    tableHtml += '    </tr>\n';
                }
            });
            tableHtml += '  </tbody>\n';
        }
        
        tableHtml += '</table>';
        
        return {
            html: tableHtml,
            nextIndex: currentIndex
        };
    }

    // Process table cell content to handle inline markdown and br tags
    private processTableCellContent(cellContent: string): string {
        if (!cellContent) return '';
        
        // First handle explicit <br> tags that might already be in the content
        let processed = cellContent.replace(/<br\s*\/?>/gi, '<br>');
        
        // Remove backslash escapes from square brackets
        processed = processed.replace(/\\(\[|\])/g, '$1');
        
        // Then process inline markdown elements
        processed = this.processInlineMarkdown(processed);
        
        return processed;
    }

    // Parse a table row and extract cell contents
    private parseTableRow(line: string): string[] {
        if (!line.includes('|')) return [];
        
        // Remove leading/trailing whitespace and outer pipes
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
        
        // Remove outer pipes and split by inner pipes
        const content = trimmed.slice(1, -1);
        const cells = content.split('|').map(cell => cell.trim());
        
        // Filter out empty cells at the end (but keep intentionally empty cells in the middle)
        while (cells.length > 0 && cells[cells.length - 1] === '') {
            cells.pop();
        }
        
        return cells;
    }

    // Parse table alignment from separator line (improved detection)
    private parseTableAlignment(separatorLine: string, expectedColumns: number): string[] {
        const cells = this.parseTableRow(separatorLine);
        const alignments: string[] = [];
        
        for (let i = 0; i < expectedColumns; i++) {
            const cell = cells[i] || '---';
            const trimmed = cell.trim();
            
            if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
                alignments.push('center');
            } else if (trimmed.endsWith(':')) {
                alignments.push('right');
            } else {
                alignments.push('left');
            }
        }
        
        return alignments;
    }

    // Fallback manual conversion for HTML to Markdown (original method)
    private fallbackHtmlToMarkdown(html: string): string {
        if (!html) return '';
        
        return html
            // Headers
            .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1')
            .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1')
            .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1')
            .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1')
            .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1')
            .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1')
            
            // Bold and italic
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
            
            // Code
            .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
            .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
            
            // Links
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
            
            // Lists
            .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '* $1\n');
            })
            .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
                let counter = 1;
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${counter++}. $1\n`);
            })
            
            // Line breaks
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
            .replace(/<p[^>]*>/gi, '')
            .replace(/<\/p>/gi, '')
            
            // Remove remaining HTML tags
            .replace(/<[^>]*>/gi, '')
            
            // Clean up whitespace
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}