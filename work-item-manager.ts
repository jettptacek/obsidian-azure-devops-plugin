import { App, Notice, TFile } from 'obsidian';
import { AzureDevOpsAPI } from './api';
import { AzureDevOpsSettings } from './settings';

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
    }

    // Pull a specific work item from Azure DevOps
    async pullSpecificWorkItem(file: TFile): Promise<boolean> {
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

    // Extract updates from note content and frontmatter
    extractUpdatesFromNote(content: string, frontmatter: string): any {
        const updates: any = {};

        // Split frontmatter into lines and parse each one
        const lines = frontmatter.split('\n');
        const frontmatterData: { [key: string]: string } = {};
        
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                frontmatterData[key] = value;
            }
        }

        // Extract title from markdown header
        const titleMatch = content.match(/^# (.+)$/m);
        if (titleMatch) {
            updates.title = titleMatch[1].trim();
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
            let tagValue = frontmatterData.tags.replace(/^["']|["']$/g, ''); // Remove quotes
            if (tagValue && tagValue !== 'None') {
                updates.tags = tagValue;
            } else {
                updates.tags = ''; // Explicitly set empty to clear tags in Azure DevOps
            }
        }

        // Extract description from Description section
        const descriptionMatch = content.match(/## Description\n\n([\s\S]*?)(?=\n## |$)/);
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
        // Remove or replace invalid characters
        return title
            .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid chars with dash
            .replace(/\s+/g, ' ')           // Normalize whitespace
            .trim()                         // Remove leading/trailing spaces
            .substring(0, 100);             // Limit length
    }

    // Convert Markdown to HTML for Azure DevOps
    markdownToHtml(markdown: string): string {
        const result = markdown
            // Tables (must be processed before other formatting)
            .replace(/\|(.+)\|\n\|[-:\s\|]+\|\n((?:\|.+\|\n?)*)/g, (match, header, rows) => {
                const headerCells = header.split('|').map((cell: string) => cell.trim()).filter((cell: string) => cell);
                const headerHtml = headerCells.map((cell: string) => `<th style="border: 2px solid #666; padding: 12px 16px; background-color: #f2f2f2; font-weight: bold;">${cell}</th>`).join('');
                
                const rowsHtml = rows.trim().split('\n').map((row: string) => {
                    const cells = row.split('|').map((cell: string) => cell.trim()).filter((cell: string) => cell);
                    return `<tr>${cells.map((cell: string) => `<td style="border: 2px solid #666; padding: 12px 16px;">${cell}</td>`).join('')}</tr>`;
                }).join('');
                
                return `<table style="border-collapse: collapse; border: 2px solid #666; width: 100%; margin: 10px 0;"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
            })
            
            // Code blocks (preserve before other processing)
            .replace(/```([\s\S]*?)```/g, (match, code) => {
                return `<pre><code>${code.trim()}</code></pre>`;
            })
            
            // Headers
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^## (.*$)/gm, '<h2>$1</h2>')
            .replace(/^# (.*$)/gm, '<h1>$1</h1>')
            
            // Horizontal rules - only underscores (___)
            .replace(/^_{3,}\s*$/gm, '<hr style="border: none; border-top: 2px solid #ccc; margin: 20px 0;">')
            
            // Bold and italic
            .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            
            // Inline code
            .replace(/`(.*?)`/g, '<code>$1</code>')
            
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            
            // Unordered lists
            .replace(/^\* (.*)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
            
            // Ordered lists
            .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/g, (match) => {
                if (!match.includes('<ul>')) {
                    return `<ol>${match}</ol>`;
                }
                return match;
            })
            
            // Split content into paragraphs based on double line breaks
            .split(/\n\s*\n/)
            .filter(para => para.trim().length > 0)
            .map(para => {
                // Don't wrap block elements in paragraphs
                if (para.match(/^<(h[1-6]|ul|ol|table|pre|hr)/)) {
                    return para;
                }
                // Replace single line breaks within paragraphs with <br>
                return `<p>${para.replace(/\n/g, '<br>')}</p>`;
            })
            .join('')
            
            // Final cleanup
            .trim();
            
        return result;
    }

    // Convert HTML to Markdown when pulling from Azure DevOps
    htmlToMarkdown(html: string): string {
        if (!html) return '';
        
        return html
            // Tables (process before other conversions)
            .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
                // Extract header
                const headerMatch = content.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
                let headerMarkdown = '';
                if (headerMatch) {
                    const headerCells = headerMatch[1].match(/<th[^>]*>(.*?)<\/th>/gi) || [];
                    const headers = headerCells.map((cell: string) => cell.replace(/<th[^>]*>(.*?)<\/th>/i, '$1').trim());
                    headerMarkdown = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;
                }
                
                // Extract body rows
                const bodyMatch = content.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || [null, content];
                const rowMatches = bodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
                const bodyMarkdown = rowMatches.map((row: string) => {
                    const cellMatches = row.match(/<td[^>]*>(.*?)<\/td>/gi) || [];
                    const cells = cellMatches.map((cell: string) => cell.replace(/<td[^>]*>(.*?)<\/td>/i, '$1').trim());
                    return `| ${cells.join(' | ')} |`;
                }).join('\n');
                
                return `\n\n${headerMarkdown}${bodyMarkdown}\n\n`;
            })
            
            // Headers (no extra spacing - let natural spacing be preserved)
            .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1')
            .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1')
            .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1')
            .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1')
            .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1')
            .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1')
            
            // Horizontal rules
            .replace(/<hr[^>]*>/gi, '___')
            
            // Code blocks
            .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```')
            
            // Bold and italic
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
            .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
            .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
            .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
            
            // Inline code
            .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
            
            // Links
            .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
            
            // Lists
            .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, '* $1');
            })
            .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
                let counter = 1;
                return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${counter++}. $1`);
            })
            
            // Convert br tags to single line breaks
            .replace(/<br\s*\/?>/gi, '\n')
            
            // Convert paragraphs - preserve the structure that was there
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
            .replace(/<p[^>]*>/gi, '')
            .replace(/<\/p>/gi, '')
            
            // Remove remaining HTML tags
            .replace(/<[^>]*>/gi, '')
            
            // Clean up whitespace more conservatively
            .replace(/\n{3,}/g, '\n\n')  // Only reduce 3+ consecutive newlines to 2
            .trim();
    }
}