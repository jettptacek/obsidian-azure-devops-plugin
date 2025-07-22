import { App, Notice, TFile } from 'obsidian';
import { AzureDevOpsAPI } from './api';
import { AzureDevOpsSettings } from './settings';
import { marked } from 'marked';

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
    customFields?: { [key: string]: any };
    needsHtmlConversion?: boolean;
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
    plugin: any;
    
    private relatedItemsCache = new Map<number, RelatedWorkItem>();
    
    private turndownService: any;
    
    constructor(app: App, api: AzureDevOpsAPI, settings: AzureDevOpsSettings, plugin: any) {
        this.app = app;
        this.api = api;
        this.settings = settings;
        this.plugin = plugin;
        
        this.initializeTurndownService();
        this.configureMarkdown();
    }

    private initializeTurndownService() {
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
        
        this.configureTurndownRules();
        
        const gfm = turndownPluginGfm.gfm;
        this.turndownService.use(gfm);
    }

    private configureMarkdown() {
        marked.setOptions({
            gfm: true,
            breaks: false,
            pedantic: false
        });
    }

    private configureTurndownRules() {
        // Azure DevOps specific HTML handling
        this.turndownService.addRule('azureDevOpsDiv', {
            filter: 'div',
            replacement: function (content: string, node: any) {
                return content ? '\n\n' + content + '\n\n' : '';
            }
        });
        
        // Handle nested lists with proper spacing
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
        
        // Handle line breaks in tables and content
        this.turndownService.addRule('lineBreaks', {
            filter: 'br',
            replacement: function (content: string, node: any) {
                let parent = node.parentNode;
                while (parent) {
                    if (parent.nodeName === 'TD' || parent.nodeName === 'TH') {
                        return '<br>';
                    }
                    parent = parent.parentNode;
                }
                
                const nextSibling = node.nextSibling;
                if (nextSibling && nextSibling.nodeType === 1 && 
                    ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(nextSibling.nodeName)) {
                    return '\n\n';
                }
                
                return '\n';
            }
        });
        
        // Enhanced table handling with alignment preservation
        this.turndownService.addRule('azureTables', {
            filter: 'table',
            replacement: function (content: string, node: any) {
                const rows = node.querySelectorAll('tr');
                if (rows.length === 0) return content;
                
                const tableRows: string[] = [];
                let alignments: string[] = [];
                let numColumns = 0;
                
                // Determine table structure
                rows.forEach((row: any, rowIndex: number) => {
                    const cells = row.querySelectorAll('th, td');
                    numColumns = Math.max(numColumns, cells.length);
                    
                    if (alignments.length === 0 || rowIndex === 0) {
                        const rowAlignments: string[] = [];
                        cells.forEach((cell: any) => {
                            const style = cell.getAttribute('style') || '';
                            const align = cell.getAttribute('align') || '';
                            
                            let alignment = 'left';
                            if (style.match(/text-align\s*:\s*center/i) || align.toLowerCase() === 'center') {
                                alignment = 'center';
                            } else if (style.match(/text-align\s*:\s*right/i) || align.toLowerCase() === 'right') {
                                alignment = 'right';
                            }
                            
                            rowAlignments.push(alignment);
                        });
                        
                        if (alignments.length === 0 || rowIndex === 0) {
                            alignments = rowAlignments;
                        }
                    }
                });
                
                while (alignments.length < numColumns) {
                    alignments.push('left');
                }
                
                // Build markdown table
                rows.forEach((row: any, rowIndex: number) => {
                    const cells = row.querySelectorAll('th, td');
                    const cellContents: string[] = [];
                    
                    for (let cellIndex = 0; cellIndex < numColumns; cellIndex++) {
                        const cell = cells[cellIndex];
                        let cellContent = '';
                        
                        if (cell) {
                            for (let i = 0; i < cell.childNodes.length; i++) {
                                const child = cell.childNodes[i];
                                if (child.nodeType === 3) {
                                    cellContent += child.textContent;
                                } else if (child.nodeName === 'BR') {
                                    cellContent += '<br>';
                                } else if (child.nodeType === 1) {
                                    const tagName = child.nodeName.toLowerCase();
                                    if (tagName === 'strong' || tagName === 'b') {
                                        cellContent += '**' + child.textContent + '**';
                                    } else if (tagName === 'em' || tagName === 'i') {
                                        cellContent += '*' + child.textContent + '*';
                                    } else if (tagName === 'code') {
                                        cellContent += '`' + child.textContent + '`';
                                    } else {
                                        cellContent += child.textContent || '';
                                    }
                                }
                            }
                        }
                        
                        cellContents.push(cellContent.trim());
                    }
                    
                    tableRows.push('| ' + cellContents.join(' | ') + ' |');
                    
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
                });
                
                return '\n\n' + tableRows.join('\n') + '\n\n';
            }
        });
    }

    updateSettings(settings: AzureDevOpsSettings) {
        this.settings = settings;
    }

    // Pull all work items from Azure DevOps
    async pullWorkItems() {
        const loadingNotice = new Notice('🔄 Pulling work items from Azure DevOps...', 0);
        
        try {
            const workItems = await this.api.getWorkItems();
            
            if (workItems.length === 0) {
                loadingNotice.hide();
                new Notice('No work items found in Azure DevOps');
                return;
            }

            loadingNotice.setMessage(`📥 Processing ${workItems.length} work items...`);
            const folderPath = 'Azure DevOps Work Items';
            
            if (!await this.app.vault.adapter.exists(folderPath)) {
                await this.app.vault.createFolder(folderPath);
            }

            let createdCount = 0;
            let updatedCount = 0;
            const totalItems = workItems.length;

            for (let index = 0; index < workItems.length; index++) {
                const workItem = workItems[index];
                
                if (index % 10 === 0 || index === totalItems - 1) {
                    const progress = Math.round(((index + 1) / totalItems) * 100);
                    loadingNotice.setMessage(`📝 Processing work items... ${progress}% (${index + 1}/${totalItems})`);
                }
                
                try {
                    const fields = workItem.fields;
                    const safeTitle = this.sanitizeFileName(fields['System.Title']);
                    const filename = `WI-${workItem.id} ${safeTitle}.md`;
                    const fullPath = `${folderPath}/${filename}`;

                    const content = await this.createWorkItemNote(workItem);

                    if (await this.app.vault.adapter.exists(fullPath)) {
                        const existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                        if (existingFile instanceof TFile) {
                            await this.app.vault.modify(existingFile, content);
                            updatedCount++;
                        }
                    } else {
                        await this.app.vault.create(fullPath, content);
                        createdCount++;
                    }
                } catch (error) {
                    console.error(`Error processing work item ${workItem.id}:`, error);
                }
            }

            loadingNotice.hide();
            new Notice(`✅ Pull complete: ${createdCount} created, ${updatedCount} updated`);

            // Smart tree view refresh - only reset baselines for items we actually pulled
            const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
            if (treeView) {
                
                // Get IDs of work items that were actually processed
                const pulledWorkItemIds = new Set(workItems.map(wi => wi.id));
                
                // Only clear change tracking for work items we actually pulled
                if (treeView.changedNotes) {
                    for (const workItemId of pulledWorkItemIds) {
                        treeView.changedNotes.delete(workItemId);
                    }
                }
                
                // Only clear relationship changes for work items we actually pulled
                if (treeView.changedRelationships) {
                    for (const workItemId of pulledWorkItemIds) {
                        treeView.changedRelationships.delete(workItemId);
                    }
                }
                
                // Set baselines for the work items we just processed using the content we created
                if (treeView.originalNoteContent) {
                    for (let index = 0; index < workItems.length; index++) {
                        const workItem = workItems[index];
                        try {
                            // We just created/updated this content, so store it as the baseline
                            const content = await this.createWorkItemNote(workItem);
                            treeView.originalNoteContent.set(workItem.id, content);
                        } catch (error) {
                            console.error(`Error setting baseline for work item ${workItem.id}:`, error);
                        }
                    }
                }
                
                // Update visual state
                if (typeof treeView.refreshTreeDisplay === 'function') {
                    await treeView.refreshTreeDisplay();
                }
                if (typeof treeView.updatePushButtonIfExists === 'function') {
                    treeView.updatePushButtonIfExists();
                }
                
                const remainingChanges = (treeView.changedNotes?.size || 0) + (treeView.changedRelationships?.size || 0);
                console.log(`✅ Established baselines for ${workItems.length} pulled work items. ${remainingChanges} items still have pending changes.`);
            }
            
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Pull failed: ${error.message}`);
            console.error('Pull error:', error);
        }
    }

    async pushSpecificWorkItem(file: TFile): Promise<boolean> {
        const loadingNotice = new Notice('🔄 Pushing to Azure DevOps...', 0);
        
        try {
            const content = await this.app.vault.read(file);
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

            const updates = this.extractUpdatesFromNote(content, frontmatter);
            
            if (Object.keys(updates).length === 0) {
                loadingNotice.hide();
                new Notice('No changes detected to push');
                return false;
            }

            const processedUpdates = await this.processDescriptionUpdates(updates);
            const success = await this.api.updateWorkItem(workItemId, processedUpdates);
            
            if (success) {
                await this.updateNotePushTimestamp(file, content);
                loadingNotice.hide();
                new Notice(`✅ Work item ${workItemId} pushed successfully`);
                
                // Notify tree view of successful push so it can clear highlighting for this specific item
                const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
                if (treeView && typeof treeView.handleSuccessfulWorkItemPush === 'function') {
                    await treeView.handleSuccessfulWorkItemPush(workItemId);
                }
                
                return true;
            } else {
                loadingNotice.hide();
                return false;
            }
            
            return success;
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error pushing work item: ${error.message}`);
            return false;
        }
    }

    async pullSpecificWorkItem(file: TFile): Promise<boolean> {
        const loadingNotice = new Notice('🔄 Pulling from Azure DevOps...', 0);
        
        try {
            const content = await this.app.vault.read(file);
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

            const workItem = await this.api.getSpecificWorkItem(workItemId);
            
            if (!workItem) {
                loadingNotice.hide();
                new Notice(`Failed to fetch work item ${workItemId} from Azure DevOps`);
                return false;
            }

            const updatedContent = await this.createWorkItemNote(workItem);
            await this.app.vault.modify(file, updatedContent);
            
            loadingNotice.hide();
            new Notice(`✅ Work item ${workItemId} pulled successfully`);

            const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
            if (treeView) {
                if (typeof treeView.updateSingleNodeAfterPull === 'function') {
                    await treeView.updateSingleNodeAfterPull(workItemId);
                } else if (typeof treeView.updateSpecificWorkItemChanges === 'function') {
                    await treeView.updateSpecificWorkItemChanges(workItemId, file);
                }
            }
            
            return true;
        } catch (error) {
            loadingNotice.hide();
            new Notice(`❌ Error pulling work item: ${error.message}`);
            return false;
        }
    }

    async pushCurrentWorkItem(): Promise<boolean> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file to push');
            return false;
        }

        return await this.pushSpecificWorkItem(activeFile);
    }

    async navigateToWorkItemInTree(workItemId: number, highlight: boolean = true) {
        const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
        if (treeView && typeof treeView.scrollToWorkItem === 'function') {
            await treeView.scrollToWorkItem(workItemId, highlight);
        } else {
            new Notice('Azure DevOps Tree view is not open. Please open it first.');
        }
    }

    async createWorkItemNote(workItem: any): Promise<string> {
        const fields = workItem.fields;
        const id = workItem.id;
        
        // Extract basic fields
        const title = fields['System.Title'] || 'Untitled';
        const workItemType = fields['System.WorkItemType'] || 'Unknown';
        const state = fields['System.State'] || 'Unknown';
        const assignedTo = fields['System.AssignedTo']?.displayName || 'Unassigned';
        const createdDate = fields['System.CreatedDate'] ? new Date(fields['System.CreatedDate']).toLocaleDateString() : 'Unknown';
        const changedDate = fields['System.ChangedDate'] ? new Date(fields['System.ChangedDate']).toLocaleDateString() : 'Unknown';
        const tags = fields['System.Tags'] || '';
        const priority = fields['Microsoft.VSTS.Common.Priority'] || '';
        const areaPath = fields['System.AreaPath'] || '';
        const iterationPath = fields['System.IterationPath'] || '';

        // Handle description with format detection
        let description = 'No description provided';
        if (fields['System.Description']) {
            const isMarkdownFormat = workItem.fieldFormats && 
                                   workItem.fieldFormats['System.Description'] && 
                                   workItem.fieldFormats['System.Description'].format === 'Markdown';
            
            description = isMarkdownFormat ? 
                         fields['System.Description'] : 
                         this.htmlToMarkdown(fields['System.Description']);
        }

        // Process custom fields
        const customFields = this.extractCustomFields(fields);
        const customFieldsYaml = this.formatCustomFieldsForYaml(customFields);
        const customFieldsMarkdown = this.formatCustomFieldsForMarkdown(customFields);

        // Process relationships
        const relationshipSections = await this.processWorkItemRelationships(workItem);

        // Create Azure DevOps URL
        const azureUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${id}`;

        // Build the note content
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

${relationshipSections}

---
*Last pulled: ${new Date().toLocaleString()}*
`;

        return content;
    }

    private async processWorkItemRelationships(workItem: any): Promise<string> {
        const relations = workItem.relations || [];
        const parentLinks: string[] = [];
        const childLinks: string[] = [];
        const relatedLinks: string[] = [];
        const duplicateLinks: string[] = [];
        const dependencyLinks: string[] = [];
        const externalLinks: string[] = [];

        // Collect related work item IDs for batch fetching
        const relatedIds = new Set<number>();
        for (const relation of relations) {
            const relatedIdMatch = relation.url.match(/\/(\d+)$/);
            if (relatedIdMatch) {
                relatedIds.add(parseInt(relatedIdMatch[1]));
            }
        }

        // Batch fetch related work item details
        await Promise.all(Array.from(relatedIds).map(id => this.getRelatedWorkItemDetails(id)));

        // Process each relationship
        for (const relation of relations) {
            const comment = relation.attributes?.comment || '';
            const relatedIdMatch = relation.url.match(/\/(\d+)$/);
            
            if (relatedIdMatch) {
                const relatedId = parseInt(relatedIdMatch[1]);
                const relatedItem = this.relatedItemsCache.get(relatedId);
                
                if (relatedItem) {
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
                            const relType = this.formatRelationType(relation.rel);
                            relatedLinks.push(`- **${relType}:** ${notePath} | [Azure DevOps](${azureUrl})${commentText}`);
                            break;
                    }
                }
            } else {
                // Handle external links
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

        // Combine all relationship sections
        const allLinks = [
            ...parentLinks,
            ...childLinks, 
            ...relatedLinks,
            ...duplicateLinks,
            ...dependencyLinks,
            ...externalLinks
        ];

        return allLinks.length > 0 ? '\n' + allLinks.join('\n') : '\n\n*No additional links or relationships*';
    }

    private async getRelatedWorkItemDetails(relatedId: number): Promise<RelatedWorkItem> {
        if (this.relatedItemsCache.has(relatedId)) {
            return this.relatedItemsCache.get(relatedId)!;
        }

        try {
            const workItem = await this.api.getSpecificWorkItem(relatedId);
            if (workItem && workItem.fields) {
                const relatedItem: RelatedWorkItem = {
                    id: relatedId,
                    title: workItem.fields['System.Title'] || `Work Item ${relatedId}`,
                    type: workItem.fields['System.WorkItemType'] || 'Unknown'
                };
                
                this.relatedItemsCache.set(relatedId, relatedItem);
                return relatedItem;
            }
        } catch (error) {
            console.error(`Failed to fetch related work item ${relatedId}:`, error);
        }

        // Fallback
        const fallback: RelatedWorkItem = {
            id: relatedId,
            title: `Work Item ${relatedId}`,
            type: 'Unknown'
        };
        this.relatedItemsCache.set(relatedId, fallback);
        return fallback;
    }

    private extractCustomFields(fields: any): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        const systemPrefixes = [
            'System.', 'Microsoft.VSTS.', 'Microsoft.TeamFoundation.',
            'WEF_', 'Microsoft.Azure.', 'Microsoft.Reporting.'
        ];
        
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
                continue;
            }
            
            if (systemPrefixes.some(prefix => fieldName.startsWith(prefix))) {
                continue;
            }
            
            if (this.isLegitimateCustomField(fieldName)) {
                customFields[fieldName] = fieldValue;
            }
        }
        
        return customFields;
    }

    private isLegitimateCustomField(fieldName: string): boolean {
        if (!/[a-zA-Z]/.test(fieldName)) return false;
        
        const validPatterns = [
            /^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*$/,
            /^[A-Za-z][A-Za-z0-9_\s]*$/,
            /^[A-Za-z][A-Za-z0-9_\-\s\.]*[A-Za-z0-9]$/
        ];
        
        return validPatterns.some(pattern => pattern.test(fieldName));
    }

    private formatCustomFieldsForYaml(customFields: { [key: string]: any }): string {
        if (Object.keys(customFields).length === 0) return '';
        
        let yaml = '\n# Custom Fields';
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
            const yamlKey = fieldName.replace(/[^a-zA-Z0-9_\.]/g, '_').toLowerCase();
            const yamlValue = this.formatValueForYaml(fieldValue);
            yaml += `\n${yamlKey}: ${yamlValue}`;
        }
        return yaml;
    }

    private formatValueForYaml(fieldValue: any): string {
        if (typeof fieldValue === 'string') {
            if (fieldValue.length > 200 || fieldValue.includes('<') || fieldValue.includes('\n')) {
                return '|\n  ' + fieldValue.replace(/\n/g, '\n  ');
            }
            return `"${fieldValue.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }
        
        if (typeof fieldValue === 'object' && fieldValue?.displayName) {
            return `"${fieldValue.displayName.replace(/"/g, '\\"')}"`;
        }
        
        return `"${String(fieldValue).replace(/"/g, '\\"')}"`;
    }

    private formatCustomFieldsForMarkdown(customFields: { [key: string]: any }): string {
        if (Object.keys(customFields).length === 0) return '';
        
        let markdown = '\n## Custom Fields\n\n';
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
            const displayName = fieldName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            const displayValue = typeof fieldValue === 'object' && fieldValue?.displayName ? 
                               fieldValue.displayName : String(fieldValue);
            
            markdown += `**${displayName}:** ${displayValue}  \n`;
        }
        return markdown;
    }

    private formatRelationType(relationType: string): string {
        const typeMap: { [key: string]: string } = {
            'System.LinkTypes.Related': 'Related',
            'System.LinkTypes.Duplicate-Forward': 'Duplicate of',
            'System.LinkTypes.Duplicate-Reverse': 'Duplicated by',
            'System.LinkTypes.Dependency-Forward': 'Successor',
            'System.LinkTypes.Dependency-Reverse': 'Predecessor',
            'Hyperlink': 'Hyperlink',
            'AttachedFile': 'Attachment'
        };

        return typeMap[relationType] || relationType
            .replace(/^System\.LinkTypes\./, '')
            .replace(/^Microsoft\.VSTS\./, '')
            .replace(/-Forward$/, ' (Forward)')
            .replace(/-Reverse$/, ' (Reverse)')
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }

    private extractUpdatesFromNote(content: string, frontmatter: string): WorkItemUpdate {
        const updates: WorkItemUpdate = {};
        const frontmatterData = this.parseFrontmatter(frontmatter);

        // Extract title from markdown header
        const titleMatch = content.match(/^---\n[\s\S]*?\n---\n\n# (.+)$/m);
        if (titleMatch) {
            const newTitle = titleMatch[1].trim();
            const frontmatterTitle = frontmatterData.title?.replace(/^["']|["']$/g, '');
            if (newTitle !== frontmatterTitle) {
                updates.title = newTitle;
            }
        }

        // Extract updates from frontmatter
        if (frontmatterData.state) updates.state = frontmatterData.state;
        if (frontmatterData.assignedTo && frontmatterData.assignedTo !== 'Unassigned') {
            updates.assignedTo = frontmatterData.assignedTo;
        }
        if (frontmatterData.priority && frontmatterData.priority !== 'null') {
            const priorityNum = parseInt(frontmatterData.priority);
            if (!isNaN(priorityNum)) updates.priority = priorityNum;
        }
        if (frontmatterData.tags !== undefined) {
            updates.tags = frontmatterData.tags === 'None' ? '' : frontmatterData.tags;
        }

        // Extract description from Description section (improved to handle content with --- separators)
        const descriptionMatch = content.match(/## Description\n\n([\s\S]*?)(?=\n## (?:Custom Fields|Links)|(?:\n---\n\*Last)|$)/);
        if (descriptionMatch) {
            let markdownDescription = descriptionMatch[1].trim();
            
            // Remove any trailing --- that might be part of the content formatting
            markdownDescription = markdownDescription.replace(/\n---\s*$/, '').trim();
            
            if (this.settings.useMarkdownInAzureDevOps) {
                updates.description = markdownDescription;
                updates.descriptionFormat = 'Markdown';
            } else {
                updates.description = markdownDescription;
                updates.descriptionFormat = 'HTML';
                updates.needsHtmlConversion = true;
            }
        }

        return updates;
    }

    private parseFrontmatter(frontmatter: string): { [key: string]: string } {
        const data: { [key: string]: string } = {};
        const lines = frontmatter.split('\n');
        
        let currentKey = '';
        let currentValue = '';
        let inLiteralBlock = false;
        
        for (const line of lines) {
            if (line.match(/^([^:]+):\s*\|$/)) {
                const match = line.match(/^([^:]+):\s*\|$/);
                if (match) {
                    currentKey = match[1].trim();
                    currentValue = '';
                    inLiteralBlock = true;
                    continue;
                }
            }
            
            if (inLiteralBlock) {
                if (line.startsWith('  ')) {
                    currentValue += (currentValue ? '\n' : '') + line.substring(2);
                    continue;
                } else {
                    data[currentKey] = currentValue;
                    inLiteralBlock = false;
                    currentKey = '';
                    currentValue = '';
                }
            }
            
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                
                if (value === '|') {
                    currentKey = key;
                    currentValue = '';
                    inLiteralBlock = true;
                    continue;
                }
                
                value = value.replace(/^["']|["']$/g, '');
                data[key] = value;
            }
        }
        
        if (inLiteralBlock && currentKey) {
            data[currentKey] = currentValue;
        }
        
        return data;
    }

    private async processDescriptionUpdates(updates: WorkItemUpdate): Promise<WorkItemUpdate> {
        if (updates.needsHtmlConversion && updates.description) {
            updates.description = await this.markdownToHtml(updates.description);
            delete updates.needsHtmlConversion;
        }
        return updates;
    }

    private htmlToMarkdown(html: string): string {
        if (!html) return '';
        
        try {
            const cleanedHtml = html
                .replace(/\s*data-[\w-]+="[^"]*"/g, '')
                .replace(/\s*class="[^"]*"/g, '')
                .replace(/(<(?!table|th|td|tr)[^>]+)\s+style="[^"]*"/g, '$1')
                .replace(/<p>\s*<\/p>/g, '')
                .replace(/<br\s*\/?>/gi, '<br>')
                .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '');
            
            let markdown = this.turndownService.turndown(cleanedHtml);
            
            return markdown
                .replace(/\n\n\n+/g, '\n\n')
                .replace(/(\n- [^\n]*)\n([^-\s])/g, '$1\n\n$2')
                .replace(/\n(#{1,6} [^\n]*)\n([^#\n])/g, '\n$1\n\n$2')
                .replace(/([^\n])\n(#{1,6} [^\n]*)/g, '$1\n\n$2')
                .trim();
        } catch (error) {
            console.error('Error converting HTML to markdown:', error);
            return this.fallbackHtmlToMarkdown(html);
        }
    }

    private async markdownToHtml(markdown: string): Promise<string> {
        if (!markdown) return '';
        
        try {
            // First, process tables with custom handler to ensure proper alignment
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

    private processTableCellContent(cellContent: string): string {
        if (!cellContent) return '';
        
        // First handle explicit <br> tags that might already be in the content
        let processed = cellContent.replace(/<br\s*\/?>/gi, '<br>');
        
        // Remove backslash escapes from square brackets
        processed = processed.replace(/\\(\[|\])/g, '$1');
        
        // Process inline markdown elements
        processed = processed
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
        
        return processed;
    }

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
                const content = line.replace(/^\s*[\*\-\+]\s*/, '');
                const processed = this.processInlineMarkdown(content);
                
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
                
                const prevLine = i > 0 ? lines[i - 1] : '';
                const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
                
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
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private processInlineMarkdown(text: string): string {
        return text
            .replace(/\\(\[|\])/g, '$1')
            .replace(/\\([*_`])/g, '$1')
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    }

    private convertMarkdownTablesToHtml(markdown: string): string {
        const lines = markdown.split('\n');
        const result: string[] = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i];
            
            if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
                const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
                
                if (nextLine.includes('|') && nextLine.includes('-')) {
                    const tableResult = this.processMarkdownTable(lines, i);
                    result.push(tableResult.html);
                    i = tableResult.nextIndex;
                    continue;
                }
            }
            
            result.push(line);
            i++;
        }
        
        return result.join('\n');
    }

    private fallbackHtmlToMarkdown(html: string): string {
        return html
            .replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, text) => '\n'.repeat(parseInt(level)) + '#'.repeat(parseInt(level)) + ' ' + text + '\n\n')
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
            .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private async updateNotePushTimestamp(file: TFile, content: string) {
        const timestamp = new Date().toLocaleString();
        
        let updatedContent = content
            .replace(/\*Last pulled: .*\*/g, `*Last pushed: ${timestamp}*`)
            .replace(/\*Last pushed: .*\*/g, `*Last pushed: ${timestamp}*`);

        if (updatedContent === content) {
            if (content.endsWith('---') || content.includes('*Last')) {
                updatedContent = content.replace(/---\s*$/, '') + `\n\n---\n*Last pushed: ${timestamp}*`;
            } else {
                updatedContent = content + `\n\n---\n*Last pushed: ${timestamp}*`;
            }
        }

        await this.app.vault.modify(file, updatedContent);
    }

    clearRelatedItemsCache() {
        this.relatedItemsCache.clear();
    }

    sanitizeFileName(title: string): string {
        if (!title) return 'Untitled';
        
        return title
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 100);
    }
}