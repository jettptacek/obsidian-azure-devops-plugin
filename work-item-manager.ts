import { App, Notice, TFile } from 'obsidian';
import { AzureDevOpsAPI } from './api';
import { AzureDevOpsSettings } from './settings';

interface WorkItemUpdate {
    title?: string;
    description?: string;
    descriptionFormat?: string;
    state?: string;
    assignedTo?: string;
    priority?: number;
    tags?: string;
}

export class WorkItemManager {
    app: App;
    api: AzureDevOpsAPI;
    settings: AzureDevOpsSettings;

    constructor(app: App, api: AzureDevOpsAPI, settings: AzureDevOpsSettings) {
        this.app = app;
        this.api = api;
        this.settings = settings;
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
                const content = this.createWorkItemNote(workItem);

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

            // Push updates to Azure DevOps
            const success = await this.api.updateWorkItem(workItemId, updates);
            
            if (success) {
                // Update the "Last pushed" timestamp in the note
                await this.updateNotePushTimestamp(file, content);
                new Notice(`Work item ${workItemId} pushed successfully`);
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
            const updatedContent = this.createWorkItemNote(workItem);
            await this.app.vault.modify(file, updatedContent);
            
            new Notice(`Work item ${workItemId} pulled successfully`);
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

    // Create markdown content for a work item
    createWorkItemNote(workItem: any): string {
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
                // Content is in HTML format, convert to Markdown
                description = this.htmlToMarkdown(fields['System.Description']);
            }
        }
        
        const tags = fields['System.Tags'] || '';
        const priority = fields['Microsoft.VSTS.Common.Priority'] || '';
        const areaPath = fields['System.AreaPath'] || '';
        const iterationPath = fields['System.IterationPath'] || '';

        // Process relationships to create parent/child links
        const relations = workItem.relations || [];
        const parentLinks: string[] = [];
        const childLinks: string[] = [];

        for (const relation of relations) {
            const relatedIdMatch = relation.url.match(/\/(\d+)$/);
            if (!relatedIdMatch) continue;
            
            const relatedId = parseInt(relatedIdMatch[1]);
            
            if (relation.rel === 'System.LinkTypes.Hierarchy-Reverse') {
                // This is a parent relationship
                const parentTitle = this.getRelatedWorkItemTitle(relation, relatedId);
                const parentNotePath = `[[WI-${relatedId} ${parentTitle}]]`;
                const parentAzureUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${relatedId}`;
                parentLinks.push(`- **Parent:** ${parentNotePath} | [View in Azure DevOps](${parentAzureUrl})`);
            } else if (relation.rel === 'System.LinkTypes.Hierarchy-Forward') {
                // This is a child relationship
                const childTitle = this.getRelatedWorkItemTitle(relation, relatedId);
                const childNotePath = `[[WI-${relatedId} ${childTitle}]]`;
                const childAzureUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_workitems/edit/${relatedId}`;
                childLinks.push(`- **Child:** ${childNotePath} | [View in Azure DevOps](${childAzureUrl})`);
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
synced: ${new Date().toISOString()}
---

# ${title}

**Work Item ID:** ${id}  
**Type:** ${workItemType}  
**State:** ${state}  
**Assigned To:** ${assignedTo}  
**Priority:** ${priority || 'Not set'}

## Relationships

${parentLinks.length > 0 ? '### Parents\n' + parentLinks.join('\n') + '\n' : ''}
${childLinks.length > 0 ? '### Children\n' + childLinks.join('\n') + '\n' : ''}
${parentLinks.length === 0 && childLinks.length === 0 ? '*No parent or child relationships*\n' : ''}

## Details

**Created:** ${createdDate}  
**Last Changed:** ${changedDate}  
**Area Path:** ${areaPath}  
**Iteration:** ${iterationPath}  
**Tags:** ${tags || 'None'}

## Description

${description}

## Links

[View in Azure DevOps](${azureUrl})

---
*Last pulled: ${new Date().toLocaleString()}*
`;

        return content;
    }

    // Helper method to get related work item title
    private getRelatedWorkItemTitle(relation: any, relatedId: number): string {
        if (relation.attributes && relation.attributes.name) {
            return this.sanitizeFileName(relation.attributes.name);
        }
        return `Work Item ${relatedId}`;
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

        // Extract description from Description section
        const descriptionMatch = content.match(/## Description\n\n([\s\S]*?)(?=\n## |---\n\*Last|$)/);
        if (descriptionMatch) {
            const markdownDescription = descriptionMatch[1].trim();
            
            if (this.settings.useMarkdownInAzureDevOps) {
                // Use native Markdown - no conversion needed
                updates.description = markdownDescription;
                updates.descriptionFormat = 'Markdown';
            } else {
                // Convert markdown to HTML for Azure DevOps
                updates.description = this.markdownToHtml(markdownDescription);
                updates.descriptionFormat = 'HTML';
            }
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

    // Convert Markdown to HTML for Azure DevOps
    markdownToHtml(markdown: string): string {
        if (!markdown) return '';
        
        return markdown
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
            .trim();
    }

    // Convert HTML to Markdown when pulling from Azure DevOps
    htmlToMarkdown(html: string): string {
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