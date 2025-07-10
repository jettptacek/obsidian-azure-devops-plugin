import { Notice, requestUrl } from 'obsidian';
import { AzureDevOpsSettings, WorkItem } from './settings';

export class AzureDevOpsAPI {
    settings: AzureDevOpsSettings;

    constructor(settings: AzureDevOpsSettings) {
        this.settings = settings;
    }

    updateSettings(settings: AzureDevOpsSettings) {
        this.settings = settings;
    }

    private validateSettings(): boolean {
        if (!this.settings.organization || !this.settings.project || !this.settings.personalAccessToken) {
            new Notice('Please configure Azure DevOps settings first');
            return false;
        }
        return true;
    }

    // Create Azure DevOps work item
    async createWorkItem(workItem: WorkItem): Promise<any> {
        if (!this.validateSettings()) return null;

        console.log('Creating work item:', workItem);
        console.log('Settings:', {
            organization: this.settings.organization,
            project: this.settings.project,
            hasToken: !!this.settings.personalAccessToken
        });

        const workItemTypeEncoded = encodeURIComponent(workItem.workItemType);
        const projectEncoded = encodeURIComponent(this.settings.project);
        const url = `https://dev.azure.com/${this.settings.organization}/${projectEncoded}/_apis/wit/workitems/$${workItemTypeEncoded}?api-version=7.0`;
        
        console.log('Request URL:', url);

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

    // Get work items with their relationships
    async getWorkItemsWithRelations(): Promise<any[]> {
        if (!this.validateSettings()) return [];

        console.log('Fetching work items with relations...');

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
                return [];
            }

            console.log(`Found ${workItemIds.length} work items, fetching details with relations...`);

            // Batch the work item IDs to avoid URL length limits
            const batchSize = 100;
            const allWorkItems = [];

            for (let i = 0; i < workItemIds.length; i += batchSize) {
                const batch = workItemIds.slice(i, i + batchSize);
                console.log(`Fetching batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(workItemIds.length / batchSize)}, IDs: ${batch.length}`);

                // Include relations in the request
                const detailsUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=relations&api-version=7.0`;

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
                    continue;
                }

                const batchResult = detailsResponse.json;
                if (batchResult.value && Array.isArray(batchResult.value)) {
                    allWorkItems.push(...batchResult.value);
                }
            }

            console.log(`Successfully fetched ${allWorkItems.length} work items with relations`);
            return allWorkItems;

        } catch (error) {
            console.error('Error fetching work items:', error);
            new Notice(`Error fetching work items: ${error.message}`);
            return [];
        }
    }

    // Get work items from Azure DevOps (without relations)
    async getWorkItems(): Promise<any[]> {
        if (!this.validateSettings()) return [];

        console.log('Fetching work items...');

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

            // Batch the work item IDs
            const batchSize = 100;
            const allWorkItems = [];

            for (let i = 0; i < workItemIds.length; i += batchSize) {
                const batch = workItemIds.slice(i, i + batchSize);
                console.log(`Fetching batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(workItemIds.length / batchSize)}, IDs: ${batch.length}`);

                const detailsUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=all&api-version=7.0`;

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
                    continue;
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

    // Get a specific work item by ID
    async getSpecificWorkItem(workItemId: number): Promise<any> {
        if (!this.validateSettings()) return null;

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

    // Update work item in Azure DevOps
    async updateWorkItem(workItemId: number, updates: any): Promise<boolean> {
        if (!this.validateSettings()) return false;

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
                requestBody.push({
                    op: 'remove',
                    path: '/fields/System.Tags'
                });
            } else {
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
}