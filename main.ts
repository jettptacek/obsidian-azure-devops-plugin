import { Plugin, Notice, Modal, Setting, TFile, PluginSettingTab, requestUrl } from 'obsidian';

interface AzureDevOpsSettings {
    organization: string;
    project: string;
    personalAccessToken: string;
    useMarkdownInAzureDevOps: boolean;
}

const DEFAULT_SETTINGS: AzureDevOpsSettings = {
    organization: '',
    project: '',
    personalAccessToken: '',
    useMarkdownInAzureDevOps: false
};

interface WorkItem {
    title: string;
    description: string;
    workItemType: string;
}

export default class AzureDevOpsPlugin extends Plugin {
    settings: AzureDevOpsSettings;

    async onload() {
        await this.loadSettings();

        // Add ribbon icon
        this.addRibbonIcon('external-link', 'Azure DevOps', () => {
            new WorkItemModal(this.app, this).open();
        });

        // Add command to pull work items
        this.addCommand({
            id: 'pull-work-items',
            name: 'Pull Work Items from Azure DevOps',
            callback: () => this.pullWorkItems()
        });

        // Add command to push current note to Azure DevOps
        this.addCommand({
            id: 'push-work-item',
            name: 'Push Work Item to Azure DevOps',
            callback: () => this.pushCurrentWorkItem()
        });

        // Add context menu item for pushing work items
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                this.addAzureDevOpsMenuItems(menu, file);
            })
        );

        // Also register for editor-menu (right-click in editor)
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view.file) {
                    this.addAzureDevOpsMenuItems(menu, view.file);
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new AzureDevOpsSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Create Azure DevOps work item
    async createWorkItem(workItem: WorkItem): Promise<any> {
        // Validate settings
        if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
            new Notice('Please configure Azure DevOps settings first');
            return;
        }

        console.log('Creating work item:', workItem);
        console.log('Settings:', {
            organization: this.settings.organization,
            project: this.settings.project,
            hasToken: !!this.settings.personalAccessToken
        });

        // Build URL - Azure DevOps API requires format: /workitems/$WorkItemType
        const workItemTypeEncoded = encodeURIComponent(workItem.workItemType);
        const projectEncoded = encodeURIComponent(this.settings.project);
        const url = `https://dev.azure.com/${this.settings.organization}/${projectEncoded}/_apis/wit/workitems/$${workItemTypeEncoded}?api-version=7.0`;
        
        console.log('Request URL:', url);
        console.log('URL contains $:', url.includes('$'));

        // Prepare request body (JSON Patch format)
        const requestBody = [
            {
                op: 'add',
                path: '/fields/System.Title',
                value: workItem.title
            },
            {
                op: 'add',
                path: '/fields/System.Description',
                value: workItem.description
            }
        ];

        console.log('Request body:', requestBody);

        try {
            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`,
                    'Content-Type': 'application/json-patch+json'
                },
                body: JSON.stringify(requestBody),
                throw: false
            });

            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);

            if (response.status >= 200 && response.status < 300) {
                const result = response.json;
                console.log('Success! Work item created:', result);
                new Notice(`Work item created: ${result.fields['System.Title']} (ID: ${result.id})`);
                return result;
            } else {
                console.error('API Error:', response.status, response.text);
                new Notice(`Error ${response.status}: ${response.text}`);
                return null;
            }
        } catch (error) {
            console.error('Request failed:', error);
            new Notice(`Request failed: ${error.message}`);
            return null;
        }
    }

    // Push a specific work item file to Azure DevOps
    async pushSpecificWorkItem(file: TFile) {
        const content = await this.app.vault.read(file);
        
        // Parse frontmatter to get work item ID
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
            return;
        }

        const frontmatter = frontmatterMatch[1];
        const idMatch = frontmatter.match(/id:\s*(\d+)/);
        
        if (!idMatch) {
            new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
            return;
        }

        const workItemId = parseInt(idMatch[1]);

        // Extract updated values from frontmatter and content
        const updates = this.extractUpdatesFromNote(content, frontmatter);
        
        if (Object.keys(updates).length === 0) {
            new Notice('No changes detected to push');
            return;
        }

        // Push updates to Azure DevOps
        const success = await this.updateWorkItem(workItemId, updates);
        
        if (success) {
            // Update the "Last pushed" timestamp in the note
            await this.updateNotePushTimestamp(file, content);
            new Notice(`Work item ${workItemId} pushed successfully`);
        }
    }

    // Pull a specific work item from Azure DevOps
    async pullSpecificWorkItem(file: TFile) {
        const content = await this.app.vault.read(file);
        
        // Parse frontmatter to get work item ID
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pulled.');
            return;
        }

        const frontmatter = frontmatterMatch[1];
        const idMatch = frontmatter.match(/id:\s*(\d+)/);
        
        if (!idMatch) {
            new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
            return;
        }

        const workItemId = parseInt(idMatch[1]);

        // Get the specific work item from Azure DevOps
        const workItem = await this.getSpecificWorkItem(workItemId);
        
        if (!workItem) {
            new Notice(`Failed to fetch work item ${workItemId} from Azure DevOps`);
            return;
        }

        // Update the note with fresh data from Azure DevOps
        const updatedContent = this.createWorkItemNote(workItem);
        await this.app.vault.modify(file, updatedContent);
        
        new Notice(`Work item ${workItemId} pulled successfully`);
    }

    // Get a specific work item by ID
    async getSpecificWorkItem(workItemId: number): Promise<any> {
        if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
            new Notice('Please configure Azure DevOps settings first');
            return null;
        }

        // Request both fields and field formats
        const url = `https://dev.azure.com/${this.settings.organization}/${this.settings.project}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=7.0`;

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
                new Notice(`Failed to fetch work item: ${response.status} - ${response.text}`);
                return null;
            }
        } catch (error) {
            new Notice(`Error fetching work item: ${error.message}`);
            return null;
        }
    }

    // Helper method to add Azure DevOps menu items
    addAzureDevOpsMenuItems(menu: any, file: any) {
        if (file instanceof TFile && file.extension === 'md') {
            // Add the menu items immediately for all markdown files
            // Check if it's a work item when clicked
            menu.addItem((item: any) => {
                item
                    .setTitle('Push to Azure DevOps')
                    .setIcon('upload')
                    .onClick(async () => {
                        // Check if it's a work item when clicked
                        const content = await this.app.vault.read(file);
                        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (!frontmatterMatch) {
                            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
                            return;
                        }

                        const frontmatter = frontmatterMatch[1];
                        const idMatch = frontmatter.match(/id:\s*(\d+)/);
                        
                        if (!idMatch) {
                            new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
                            return;
                        }
                        
                        await this.pushSpecificWorkItem(file);
                    });
            });

            menu.addItem((item: any) => {
                item
                    .setTitle('Pull from Azure DevOps')
                    .setIcon('download')
                    .onClick(async () => {
                        // Check if it's a work item when clicked
                        const content = await this.app.vault.read(file);
                        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (!frontmatterMatch) {
                            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pulled.');
                            return;
                        }

                        const frontmatter = frontmatterMatch[1];
                        const idMatch = frontmatter.match(/id:\s*(\d+)/);
                        
                        if (!idMatch) {
                            new Notice('This note doesn\'t have a work item ID. Only work item notes can be pulled.');
                            return;
                        }
                        
                        await this.pullSpecificWorkItem(file);
                    });
            });
        }
    }

    // Get work items from Azure DevOps
    async getWorkItems(): Promise<any[]> {
        if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
            new Notice('Please configure Azure DevOps settings first');
            return [];
        }

        console.log('Fetching work items...');

        // First, query for work items (gets IDs)
        const wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] 
                      FROM WorkItems 
                      WHERE [System.TeamProject] = '${this.settings.project}' 
                      ORDER BY [System.ChangedDate] DESC`;

        const queryUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/wiql?api-version=7.0`;

        try {
            // Step 1: Query for work item IDs
            const queryResponse = await requestUrl({
                url: queryUrl,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: wiql }),
                throw: false
            });

            if (queryResponse.status < 200 || queryResponse.status >= 300) {
                console.error('Query failed:', queryResponse.status, queryResponse.text);
                new Notice(`Failed to query work items: ${queryResponse.status}`);
                return [];
            }

            const queryResult = queryResponse.json;
            const workItemIds = queryResult.workItems.map((wi: any) => wi.id);

            if (workItemIds.length === 0) {
                new Notice('No work items found');
                return [];
            }

            console.log(`Found ${workItemIds.length} work items, fetching details...`);

            // Batch the work item IDs to avoid URL length limits and API limits
            const batchSize = 100; // Azure DevOps recommends max 200, but let's be conservative
            const allWorkItems = [];

            for (let i = 0; i < workItemIds.length; i += batchSize) {
                const batch = workItemIds.slice(i, i + batchSize);
                console.log(`Fetching batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(workItemIds.length / batchSize)}, IDs: ${batch.length}`);

                const detailsUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=all&api-version=7.0`;

                console.log('Details URL:', detailsUrl);

                const detailsResponse = await requestUrl({
                    url: detailsUrl,
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`
                    },
                    throw: false
                });

                console.log(`Batch ${Math.floor(i / batchSize) + 1} response status:`, detailsResponse.status);

                if (detailsResponse.status < 200 || detailsResponse.status >= 300) {
                    console.error(`Batch ${Math.floor(i / batchSize) + 1} response:`, detailsResponse.text);
                    new Notice(`Failed to fetch work item details for batch ${Math.floor(i / batchSize) + 1}: ${detailsResponse.status}`);
                    continue; // Skip this batch but continue with others
                }

                const batchResult = detailsResponse.json;
                if (batchResult.value && Array.isArray(batchResult.value)) {
                    allWorkItems.push(...batchResult.value);
                }
            }

            console.log(`Successfully fetched ${allWorkItems.length} work items total`);
            return allWorkItems;

        } catch (error) {
            console.error('Error fetching work items:', error);
            new Notice(`Error fetching work items: ${error.message}`);
            return [];
        }
    }

    // Pull work items to Obsidian notes
    async pullWorkItems() {
        const workItems = await this.getWorkItems();
        
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

    // Sanitize filename for file system
    sanitizeFileName(title: string): string {
        // Remove or replace invalid characters
        return title
            .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid chars with dash
            .replace(/\s+/g, ' ')           // Normalize whitespace
            .trim()                         // Remove leading/trailing spaces
            .substring(0, 100);             // Limit length
    }

    // Push current work item note to Azure DevOps
    async pushCurrentWorkItem() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file to push');
            return;
        }

        const content = await this.app.vault.read(activeFile);
        
        // Parse frontmatter to get work item ID
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            new Notice('This note doesn\'t have frontmatter. Only work item notes can be pushed.');
            return;
        }

        const frontmatter = frontmatterMatch[1];
        const idMatch = frontmatter.match(/id:\s*(\d+)/);
        
        if (!idMatch) {
            new Notice('This note doesn\'t have a work item ID. Only pulled work items can be pushed.');
            return;
        }

        const workItemId = parseInt(idMatch[1]);

        // Extract updated values from frontmatter and content
        const updates = this.extractUpdatesFromNote(content, frontmatter);
        
        if (Object.keys(updates).length === 0) {
            new Notice('No changes detected to push');
            return;
        }

        // Push updates to Azure DevOps
        const success = await this.updateWorkItem(workItemId, updates);
        
        if (success) {
            // Update the "Last pushed" timestamp in the note
            await this.updateNotePushTimestamp(activeFile, content);
            new Notice(`Work item ${workItemId} pushed successfully`);
        }
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

    // Update work item in Azure DevOps
    async updateWorkItem(workItemId: number, updates: any): Promise<boolean> {
        if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
            new Notice('Please configure Azure DevOps settings first');
            return false;
        }

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems/${workItemId}?api-version=7.0`;
        
        const requestBody = [];

        // Map updates to Azure DevOps fields
        if (updates.title) {
            requestBody.push({
                op: 'replace',
                path: '/fields/System.Title',
                value: updates.title
            });
        }

        if (updates.description) {
            requestBody.push({
                op: 'replace',
                path: '/fields/System.Description',
                value: updates.description
            });

            // Set the format for the description field if using Markdown
            if (updates.descriptionFormat === 'Markdown') {
                requestBody.push({
                    op: 'add',
                    path: '/multilineFieldsFormat/System.Description',
                    value: 'Markdown'
                });
            }
        }

        if (updates.state) {
            requestBody.push({
                op: 'replace',
                path: '/fields/System.State',
                value: updates.state
            });
        }

        if (updates.assignedTo) {
            requestBody.push({
                op: 'replace',
                path: '/fields/System.AssignedTo',
                value: updates.assignedTo
            });
        }

        if (updates.priority) {
            requestBody.push({
                op: 'replace',
                path: '/fields/Microsoft.VSTS.Common.Priority',
                value: updates.priority.toString()
            });
        }

        if (updates.hasOwnProperty('tags')) {
            if (updates.tags === '') {
                // Clear tags in Azure DevOps
                requestBody.push({
                    op: 'remove',
                    path: '/fields/System.Tags'
                });
            } else {
                // Set tags in Azure DevOps
                requestBody.push({
                    op: 'replace',
                    path: '/fields/System.Tags',
                    value: updates.tags
                });
            }
        }

        if (requestBody.length === 0) {
            console.log('No valid updates to push');
            return false;
        }

        try {
            const response = await requestUrl({
                url: url,
                method: 'PATCH',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`,
                    'Content-Type': 'application/json-patch+json'
                },
                body: JSON.stringify(requestBody),
                throw: false
            });

            if (response.status >= 200 && response.status < 300) {
                return true;
            } else {
                new Notice(`Push failed: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            new Notice(`Push failed: ${error.message}`);
            return false;
        }
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

// Modal for creating work items
class WorkItemModal extends Modal {
    plugin: AzureDevOpsPlugin;
    workItem: WorkItem;

    constructor(app: any, plugin: AzureDevOpsPlugin) {
        super(app);
        this.plugin = plugin;
        this.workItem = {
            title: '',
            description: '',
            workItemType: 'Task'
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Create Azure DevOps Work Item' });

        new Setting(contentEl)
            .setName('Title')
            .setDesc('Work item title')
            .addText(text => text
                .setPlaceholder('Enter title')
                .setValue(this.workItem.title)
                .onChange(async (value) => {
                    this.workItem.title = value;
                }));

        new Setting(contentEl)
            .setName('Type')
            .setDesc('Work item type')
            .addDropdown(dropdown => dropdown
                .addOption('Task', 'Task')
                .addOption('Bug', 'Bug')
                .addOption('User Story', 'User Story')
                .addOption('Feature', 'Feature')
                .setValue(this.workItem.workItemType)
                .onChange(async (value) => {
                    this.workItem.workItemType = value;
                }));

        new Setting(contentEl)
            .setName('Description')
            .setDesc('Work item description')
            .addTextArea(text => text
                .setPlaceholder('Enter description')
                .setValue(this.workItem.description)
                .onChange(async (value) => {
                    this.workItem.description = value;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Create Work Item')
                .setCta()
                .onClick(async () => {
                    if (!this.workItem.title) {
                        new Notice('Title is required');
                        return;
                    }
                    await this.plugin.createWorkItem(this.workItem);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Settings tab
class AzureDevOpsSettingTab extends PluginSettingTab {
    plugin: AzureDevOpsPlugin;

    constructor(app: any, plugin: AzureDevOpsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Azure DevOps Settings' });

        new Setting(containerEl)
            .setName('Organization')
            .setDesc('Azure DevOps organization name (just the name, not the full URL)')
            .addText(text => text
                .setPlaceholder('your-org')
                .setValue(this.plugin.settings.organization)
                .onChange(async (value) => {
                    this.plugin.settings.organization = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Project')
            .setDesc('Azure DevOps project name')
            .addText(text => text
                .setPlaceholder('your-project')
                .setValue(this.plugin.settings.project)
                .onChange(async (value) => {
                    this.plugin.settings.project = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Personal Access Token')
            .setDesc('Azure DevOps Personal Access Token with work item permissions')
            .addText(text => text
                .setPlaceholder('your-pat-token')
                .setValue(this.plugin.settings.personalAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.personalAccessToken = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Use Markdown in Azure DevOps')
            .setDesc('Enable native Markdown support in Azure DevOps (recommended for new work items). Note: Once enabled for a work item, it cannot be reverted to HTML.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useMarkdownInAzureDevOps)
                .onChange(async (value) => {
                    this.plugin.settings.useMarkdownInAzureDevOps = value;
                    await this.plugin.saveSettings();
                }));
    }
}