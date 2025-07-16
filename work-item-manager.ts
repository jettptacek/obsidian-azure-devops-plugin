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

    // Configure Turndown service for Azure DevOps specific HTML handling
    private configureTurndownService() {
        // Handle Azure DevOps specific elements
        this.turndownService.addRule('azureDevOpsDiv', {
            filter: 'div',
            replacement: function (content: string) {
                return content + '\n\n';
            }
        });
        
        // Handle nested lists better
        this.turndownService.addRule('nestedLists', {
            filter: ['ul', 'ol'],
            replacement: function (content: string, node: any) {
                const parent = node.parentNode;
                if (parent && parent.nodeName === 'LI') {
                    return '\n' + content;
                }
                return '\n' + content + '\n';
            }
        });
        
        // Handle line breaks in Azure DevOps content
        this.turndownService.addRule('lineBreaks', {
            filter: 'br',
            replacement: function () {
                return '\n';
            }
        });
        
        // Handle Azure DevOps tables (this will be enhanced by the GFM plugin)
        this.turndownService.addRule('azureTables', {
            filter: 'table',
            replacement: function (content: string) {
                return '\n' + content + '\n';
            }
        });
    }

    updateSettings(settings: AzureDevOpsSettings) {
        this.settings = settings;
    }

    // Pull work items to Obsidian notes
    async pullWorkItems() {
        const workItems = await this.api.getWorkItems();
        
        if (workItems.length === 0) {
            return;
        }

        const folderPath = 'Azure DevOps Work Items';
        
        // Create folder if it doesn't exist
        if (!await this.app.vault.adapter.exists(folderPath)) {
            await this.app.vault.createFolder(folderPath);
            console.log(`Created folder: ${folderPath}`);
        }

        let createdCount = 0;
        let updatedCount = 0;

        for (const workItem of workItems) {
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

        new Notice(`Pull complete: ${createdCount} created, ${updatedCount} updated`);
        
        // NEW: Refresh change detection in tree view if it exists
        const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
        if (treeView && typeof treeView.refreshChangeDetection === 'function') {
            await treeView.refreshChangeDetection();
        }
    }

    // Push a specific work item file to Azure DevOps
    async pushSpecificWorkItem(file: TFile): Promise<boolean> {
        try {
            const content = await this.app.vault.read(file);
            
            // Parse frontmatter to get work item ID
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
                new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
                return false;
            }

            const frontmatter = frontmatterMatch[1];
            const idMatch = frontmatter.match(/id:\s*(\d+)/);
            
            if (!idMatch) {
                new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
                return false;
            }

            const workItemId = parseInt(idMatch[1]);

            // Extract updated values from frontmatter and content
            const updates = this.extractUpdatesFromNote(content, frontmatter);
            
            if (Object.keys(updates).length === 0) {
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
                new Notice(`Work item ${workItemId} pushed successfully`);
                
                // NEW: Refresh change detection in tree view if it exists
                const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
                if (treeView && typeof treeView.refreshChangeDetection === 'function') {
                    await treeView.refreshChangeDetection();
                }
            }
            
            return success;
        } catch (error) {
            new Notice(`Error pushing work item: ${error.message}`);
            return false;
        }
    }

    // Pull a specific work item from Azure DevOps
    async pullSpecificWorkItem(file: TFile): Promise<boolean> {
        try {
            const content = await this.app.vault.read(file);
            
            // Parse frontmatter to get work item ID
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
                new Notice('This note doesn\'t have frontmatter. Only work item notes can be pulled.');
                return false;
            }

            const frontmatter = frontmatterMatch[1];
            const idMatch = frontmatter.match(/id:\s*(\d+)/);
            
            if (!idMatch) {
                new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                return false;
            }

            const workItemId = parseInt(idMatch[1]);

            // Get the specific work item from Azure DevOps
            const workItem = await this.api.getSpecificWorkItem(workItemId);
            
            if (!workItem) {
                new Notice(`Failed to fetch work item ${workItemId} from Azure DevOps`);
                return false;
            }

            // Update the note with fresh data from Azure DevOps
            const updatedContent = await this.createWorkItemNote(workItem);
            await this.app.vault.modify(file, updatedContent);
            
            new Notice(`Work item ${workItemId} pulled successfully`);
            
            // NEW: Update change detection for this specific item only
            const treeView = this.plugin.app.workspace.getLeavesOfType('azure-devops-tree-view')[0]?.view;
            if (treeView && typeof treeView.updateSpecificWorkItemChanges === 'function') {
                await treeView.updateSpecificWorkItemChanges(workItemId, file);
            }
            
            return true;
        } catch (error) {
            new Notice(`Error pulling work item: ${error.message}`);
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
        console.log('Analyzing work item for custom fields...');
        const potentialCustomFields = this.debugWorkItemFields(workItem);
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

    // NEW: Debug method to inspect all fields from a work item
    debugWorkItemFields(workItem: any) {
        console.log('=== WORK ITEM FIELD ANALYSIS ===');
        console.log('Work Item ID:', workItem.id);
        console.log('Work Item Type:', workItem.fields['System.WorkItemType']);
        console.log('Total fields:', Object.keys(workItem.fields).length);
        
        const systemFields = [];
        const vstsFields = [];
        const potentialCustomFields = [];
        const emptyFields = [];
        
        for (const [fieldName, fieldValue] of Object.entries(workItem.fields)) {
            if (fieldName.startsWith('System.')) {
                systemFields.push(fieldName);
            } else if (fieldName.startsWith('Microsoft.VSTS.')) {
                vstsFields.push(fieldName);
            } else {
                if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
                    emptyFields.push(fieldName);
                } else {
                    potentialCustomFields.push({ name: fieldName, value: fieldValue });
                }
            }
        }
        
        console.log('\n--- System Fields ---');
        console.log(systemFields);
        
        console.log('\n--- VSTS Fields ---');
        console.log(vstsFields);
        
        console.log('\n--- Potential Custom Fields (with values) ---');
        potentialCustomFields.forEach(field => {
            console.log(`${field.name}: ${JSON.stringify(field.value)}`);
        });
        
        console.log('\n--- Empty Fields ---');
        console.log(emptyFields);
        
        console.log('=== END ANALYSIS ===\n');
        
        return potentialCustomFields;
    }

    // NEW: Extract custom fields from Azure DevOps fields
    extractCustomFields(fields: any): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        console.log('=== DEBUGGING CUSTOM FIELDS ===');
        console.log('All fields from Azure DevOps:', Object.keys(fields));
        
        // Azure DevOps custom fields can have various patterns
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            console.log(`Checking field: ${fieldName} = ${fieldValue}`);
            
            // More comprehensive detection of custom fields
            const isSystemField = fieldName.startsWith('System.');
            const isVSTSCommonField = fieldName.startsWith('Microsoft.VSTS.Common.');
            const isVSTSSchedulingField = fieldName.startsWith('Microsoft.VSTS.Scheduling.');
            const isVSTSTCMField = fieldName.startsWith('Microsoft.VSTS.TCM.');
            const isVSTSBuildField = fieldName.startsWith('Microsoft.VSTS.Build.');
            const isVSTSCodeReviewField = fieldName.startsWith('Microsoft.VSTS.CodeReview.');
            
            // NEW: Filter out WEF (Work Item Extension Framework) fields and other system extensions
            const isWEFField = fieldName.startsWith('WEF_') || 
                              fieldName.includes('System.Extensionmarker') ||
                              fieldName.includes('Kanban Column') ||
                              fieldName.includes('Board Column') ||
                              fieldName.includes('Board Lane') ||
                              fieldName.match(/^Wef\s+[0-9a-f]{32}/i); // Matches "Wef 188e8f3dabba4f4ca806652d0e870da0" pattern
            
            const isInternalField = fieldName === 'System.Id' || 
                                   fieldName === 'System.Rev' || 
                                   fieldName === 'System.AuthorizedDate' || 
                                   fieldName === 'System.RevisedDate' || 
                                   fieldName === 'System.Watermark' ||
                                   fieldName === 'System.PersonId' ||
                                   fieldName === 'System.AuthorizedAs' ||
                                   fieldName === 'System.CommentCount' ||
                                   fieldName === 'System.HyperLinkCount' ||
                                   fieldName === 'System.AttachedFileCount' ||
                                   fieldName === 'System.NodeName' ||
                                   fieldName === 'System.AreaLevel1' ||
                                   fieldName === 'System.AreaLevel2' ||
                                   fieldName === 'System.AreaLevel3' ||
                                   fieldName === 'System.AreaLevel4';
            
            // Check if this might be a custom field
            if (!isSystemField && 
                !isVSTSCommonField && 
                !isVSTSSchedulingField && 
                !isVSTSTCMField && 
                !isVSTSBuildField && 
                !isVSTSCodeReviewField && 
                !isWEFField &&
                !isInternalField) {
                
                // This is likely a custom field
                console.log(`>>> FOUND CUSTOM FIELD: ${fieldName} = ${fieldValue}`);
                
                if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                    const cleanFieldName = this.cleanCustomFieldName(fieldName);
                    customFields[cleanFieldName] = fieldValue;
                    console.log(`>>> ADDED: ${cleanFieldName} = ${fieldValue}`);
                } else {
                    console.log(`>>> SKIPPED (empty value): ${fieldName}`);
                }
            } else {
                if (isWEFField) {
                    console.log(`>>> SKIPPED (WEF/system extension field): ${fieldName}`);
                } else {
                    console.log(`>>> SKIPPED (system field): ${fieldName}`);
                }
            }
        }
        
        console.log('Final custom fields:', customFields);
        console.log('=== END DEBUGGING ===');
        
        return customFields;
    }

    // NEW: Clean up custom field names for YAML and display
    cleanCustomFieldName(fieldName: string): string {
        return fieldName
            .replace(/^(Custom\.|MyCompany\.|Custom_)/i, '') // Remove common prefixes
            .replace(/[^a-zA-Z0-9_]/g, '_') // Replace special chars with underscore
            .replace(/_{2,}/g, '_') // Replace multiple underscores with single
            .replace(/^_|_$/g, '') // Remove leading/trailing underscores
            .toLowerCase();
    }

    // NEW: Format custom fields for YAML frontmatter
    formatCustomFieldsForYaml(customFields: { [key: string]: any }): string {
        if (Object.keys(customFields).length === 0) {
            return '';
        }
        
        let yaml = '\n# Custom Fields';
        for (const [fieldName, fieldValue] of Object.entries(customFields)) {
            // Handle different value types
            if (typeof fieldValue === 'string') {
                yaml += `\n${fieldName}: "${fieldValue.replace(/"/g, '\\"')}"`;
            } else if (typeof fieldValue === 'number') {
                yaml += `\n${fieldName}: ${fieldValue}`;
            } else if (typeof fieldValue === 'boolean') {
                yaml += `\n${fieldName}: ${fieldValue}`;
            } else if (fieldValue && typeof fieldValue === 'object') {
                // Handle complex objects (like person fields)
                if (fieldValue.displayName) {
                    yaml += `\n${fieldName}: "${fieldValue.displayName}"`;
                } else {
                    yaml += `\n${fieldName}: "${JSON.stringify(fieldValue).replace(/"/g, '\\"')}"`;
                }
            } else {
                yaml += `\n${fieldName}: "${String(fieldValue).replace(/"/g, '\\"')}"`;
            }
        }
        return yaml;
    }

    // NEW: Format custom fields for markdown display
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

    // NEW: Format field names for display
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

        // Parse frontmatter into key-value pairs
        const frontmatterData: { [key: string]: string } = {};
        const lines = frontmatter.split('\n');
        
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                let value = line.substring(colonIndex + 1).trim();
                // Remove quotes if present
                value = value.replace(/^["']|["']$/g, '');
                frontmatterData[key] = value;
            }
        }

        // Extract title from markdown header
        const titleMatch = content.match(/^# (.+)$/m);
        if (titleMatch) {
            const newTitle = titleMatch[1].trim();
            if (newTitle !== frontmatterData.title?.replace(/^["']|["']$/g, '')) {
                updates.title = newTitle;
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

        // NEW: Extract custom fields from frontmatter
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
                // Note: This is now async, but we'll handle it in the calling function
                updates.description = markdownDescription;
                updates.descriptionFormat = 'HTML';
                updates.needsHtmlConversion = true; // Flag for async conversion
            }
        }

        // NEW: Extract custom fields from Custom Fields section
        const customFieldsMatch = content.match(/## Custom Fields\n\n([\s\S]*?)(?=\n## |---\n\*Last|$)/);
        if (customFieldsMatch) {
            const customFieldsFromMarkdown = this.parseCustomFieldsFromMarkdown(customFieldsMatch[1]);
            if (Object.keys(customFieldsFromMarkdown).length > 0) {
                updates.customFields = { ...updates.customFields, ...customFieldsFromMarkdown };
            }
        }

        return updates;
    }

    // NEW: Extract custom field updates from frontmatter
    extractCustomFieldUpdates(frontmatterData: { [key: string]: string }): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        // Skip standard fields and look for custom fields
        const standardFields = new Set([
            'id', 'title', 'type', 'state', 'assignedTo', 'createdDate', 
            'changedDate', 'priority', 'areaPath', 'iterationPath', 'tags', 
            'azureUrl', 'synced'
        ]);
        
        for (const [key, value] of Object.entries(frontmatterData)) {
            if (!standardFields.has(key) && !key.startsWith('#') && value !== '') {
                // Convert the cleaned field name back to Azure DevOps format if needed
                const azureFieldName = this.convertToAzureFieldName(key);
                customFields[azureFieldName] = this.parseFieldValue(value);
            }
        }
        
        return customFields;
    }

    // NEW: Parse custom fields from markdown section
    parseCustomFieldsFromMarkdown(markdownContent: string): { [key: string]: any } {
        const customFields: { [key: string]: any } = {};
        
        // Parse lines like "**Field Name:** Field Value"
        const fieldLines = markdownContent.split('\n').filter(line => line.trim().length > 0);
        
        for (const line of fieldLines) {
            const match = line.match(/\*\*([^*]+):\*\*\s*(.+)/);
            if (match) {
                const fieldDisplayName = match[1].trim();
                const fieldValue = match[2].trim();
                
                // Convert display name back to field name
                const fieldName = fieldDisplayName.toLowerCase().replace(/\s+/g, '_');
                const azureFieldName = this.convertToAzureFieldName(fieldName);
                customFields[azureFieldName] = this.parseFieldValue(fieldValue);
            }
        }
        
        return customFields;
    }

    // NEW: Convert cleaned field name back to Azure DevOps format
    convertToAzureFieldName(cleanedName: string): string {
        // This is a best-effort conversion. You might need to maintain a mapping
        // for more complex scenarios or get the original field names from Azure DevOps
        
        // For now, assume custom fields follow the pattern Custom.FieldName
        if (cleanedName.includes('_')) {
            // Convert snake_case back to proper casing
            return 'Custom.' + cleanedName.split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('');
        }
        
        return 'Custom.' + cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1);
    }

    // NEW: Parse field value with appropriate type conversion
    parseFieldValue(value: string): any {
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
        
        // Return as string
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

    // Convert Markdown to HTML for Azure DevOps using Marked
    async markdownToHtml(markdown: string): Promise<string> {
        if (!markdown) return '';
        
        try {
            // Use marked to convert markdown to HTML (marked returns a Promise in newer versions)
            let html = await marked(markdown);
            
            // Clean up the HTML for Azure DevOps compatibility
            html = html
                // Add borders and styling to tables for Azure DevOps
                .replace(/<table>/g, '<table border="1" style="border-collapse: collapse; border: 1px solid #ccc;">')
                .replace(/<th>/g, '<th style="border: 1px solid #ccc; padding: 8px; background-color: #f5f5f5;">')
                .replace(/<td>/g, '<td style="border: 1px solid #ccc; padding: 8px;">')
                
                // Remove extra paragraph tags around single lines
                .replace(/^<p>(.*)<\/p>$/gm, '$1')
                
                // Fix list formatting for Azure DevOps
                .replace(/<ul>\s*<li>/g, '<ul><li>')
                .replace(/<\/li>\s*<\/ul>/g, '</li></ul>')
                .replace(/<ol>\s*<li>/g, '<ol><li>')
                .replace(/<\/li>\s*<\/ol>/g, '</li></ol>')
                
                // Ensure proper spacing
                .trim();
            
            return html;
        } catch (error) {
            console.error('Error converting markdown to HTML:', error);
            // Fallback to original manual conversion if marked fails
            return this.fallbackMarkdownToHtml(markdown);
        }
    }

    // Convert HTML to Markdown when pulling from Azure DevOps using Turndown
    htmlToMarkdown(html: string): string {
        if (!html) return '';
        
        try {
            // Clean up Azure DevOps HTML before conversion
            const cleanedHtml = html
                // Remove Azure DevOps specific attributes
                .replace(/\s*(data-[\w-]+|style)="[^"]*"/g, '')
                // Remove empty paragraphs
                .replace(/<p>\s*<\/p>/g, '')
                // Fix malformed HTML
                .replace(/<br\s*\/?>/gi, '<br>')
                // Remove script and style tags
                .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '');
            
            // Convert using Turndown
            let markdown = this.turndownService.turndown(cleanedHtml);
            
            // Post-process the markdown for better formatting
            markdown = markdown
                // Remove excessive blank lines
                .replace(/\n{3,}/g, '\n\n')
                // Fix list spacing
                .replace(/(\n-\s)/g, '\n- ')
                .replace(/(\n\d+\.\s)/g, '\n1. ')
                // Trim whitespace
                .trim();
            
            return markdown;
        } catch (error) {
            console.error('Error converting HTML to markdown:', error);
            // Fallback to original manual conversion if turndown fails
            return this.fallbackHtmlToMarkdown(html);
        }
    }

    // Fallback manual conversion for Markdown to HTML (original method)
    private fallbackMarkdownToHtml(markdown: string): string {
        if (!markdown) return '';
        
        let html = markdown;
        
        // Handle tables first (basic markdown table support)
        html = html.replace(/\|(.+)\|/g, (match: string, content: string) => {
            const cells = content.split('|').map((cell: string) => cell.trim());
            const isHeaderRow = cells.every((cell: string) => cell.includes('-'));
            
            if (isHeaderRow) {
                // Skip separator rows
                return '';
            }
            
            const cellTags = cells.map((cell: string) => 
                `<td style="border: 1px solid #ccc; padding: 8px;">${cell}</td>`
            ).join('');
            
            return `<tr>${cellTags}</tr>`;
        });
        
        // Wrap table rows in table tags
        html = html.replace(/(<tr>.*<\/tr>)/g, '<table border="1" style="border-collapse: collapse; border: 1px solid #ccc;">$1</table>');
        
        return html
            // Headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^# (.*$)/gm, '<h1>$1</h1>')
            
            // Bold and italic
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            
            // Code blocks
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            
            // Lists
            .replace(/^\* (.*)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
            .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
            
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/^(.*)$/gm, '<p>$1</p>')
            
            // Clean up
            .replace(/<p><\/p>/g, '')
            .replace(/<p>(<[hl])/g, '$1')
            .replace(/(<\/[hl][^>]*>)<\/p>/g, '$1')
            .replace(/<p>(<table)/g, '$1')
            .replace(/(<\/table>)<\/p>/g, '$1')
            .trim();
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