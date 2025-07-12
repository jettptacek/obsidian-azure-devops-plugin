import { Notice, requestUrl } from 'obsidian';
import { AzureDevOpsSettings, WorkItem } from './settings';

interface RelationshipChange {
    action: 'add' | 'remove';
    relationType?: string;
    relatedWorkItemId?: number;
    relationIndex?: number;
    comment?: string;
}

interface WorkItemRelation {
    rel: string;
    url: string;
    attributes?: {
        comment?: string;
        name?: string;
    };
}

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

        const workItemTypeEncoded = encodeURIComponent(workItem.workItemType);
        const projectEncoded = encodeURIComponent(this.settings.project);
        const url = `https://dev.azure.com/${this.settings.organization}/${projectEncoded}/_apis/wit/workitems/$${workItemTypeEncoded}?api-version=7.0`;

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

            if (response.status >= 200 && response.status < 300) {
                const result = response.json;
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

        const wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] 
                      FROM WorkItems 
                      WHERE [System.TeamProject] = '${this.settings.project}' 
                      ORDER BY [System.ChangedDate] DESC`;

        const queryUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/wiql?api-version=7.0`;

        try {
            // Query for work item IDs
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
                new Notice(`Failed to query work items: ${queryResponse.status}`);
                return [];
            }

            const queryResult = queryResponse.json;
            const workItemIds = queryResult.workItems.map((wi: any) => wi.id);

            if (workItemIds.length === 0) {
                return [];
            }

            // Fetch work items with relations in batches
            const batchSize = 100;
            const allWorkItems = [];

            for (let i = 0; i < workItemIds.length; i += batchSize) {
                const batch = workItemIds.slice(i, i + batchSize);
                const detailsUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=relations&api-version=7.0`;

                const detailsResponse = await requestUrl({
                    url: detailsUrl,
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`
                    },
                    throw: false
                });

                if (detailsResponse.status >= 200 && detailsResponse.status < 300) {
                    const batchResult = detailsResponse.json;
                    if (batchResult.value && Array.isArray(batchResult.value)) {
                        allWorkItems.push(...batchResult.value);
                    }
                }
            }

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

        const wiql = `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] 
                      FROM WorkItems 
                      WHERE [System.TeamProject] = '${this.settings.project}' 
                      ORDER BY [System.ChangedDate] DESC`;

        const queryUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/wiql?api-version=7.0`;

        try {
            // Query for work item IDs
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
                new Notice(`Failed to query work items: ${queryResponse.status}`);
                return [];
            }

            const queryResult = queryResponse.json;
            const workItemIds = queryResult.workItems.map((wi: any) => wi.id);

            if (workItemIds.length === 0) {
                new Notice('No work items found');
                return [];
            }

            // Fetch work items in batches
            const batchSize = 100;
            const allWorkItems = [];

            for (let i = 0; i < workItemIds.length; i += batchSize) {
                const batch = workItemIds.slice(i, i + batchSize);
                const detailsUrl = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=all&api-version=7.0`;

                const detailsResponse = await requestUrl({
                    url: detailsUrl,
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`
                    },
                    throw: false
                });

                if (detailsResponse.status >= 200 && detailsResponse.status < 300) {
                    const batchResult = detailsResponse.json;
                    if (batchResult.value && Array.isArray(batchResult.value)) {
                        allWorkItems.push(...batchResult.value);
                    }
                } else {
                    new Notice(`Failed to fetch work item details for batch: ${detailsResponse.status}`);
                }
            }

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

    // Add parent-child relationship (simplified method)
    async addParentChildRelationship(childId: number, parentId: number): Promise<boolean> {
        if (!this.validateSettings()) return false;

        // First remove any existing parent relationships to avoid duplicates
        await this.removeAllParentRelationships(childId);

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems/${childId}?api-version=7.0`;
        
        const requestBody = [{
            op: 'add',
            path: '/relations/-',
            value: {
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: `https://dev.azure.com/${this.settings.organization}/_apis/wit/workItems/${parentId}`,
                attributes: {
                    comment: 'Parent relationship added from Obsidian'
                }
            }
        }];

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
                console.log(`Successfully added parent ${parentId} to child ${childId}`);
                return true;
            } else {
                new Notice(`Failed to add parent relationship: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            new Notice(`Error adding parent relationship: ${error.message}`);
            return false;
        }
    }

    // Remove all parent relationships for a work item
    async removeAllParentRelationships(childId: number): Promise<boolean> {
        const workItem = await this.getSpecificWorkItem(childId);
        if (!workItem) return false;

        const relations: WorkItemRelation[] = workItem.relations || [];
        const parentRelationIndexes: number[] = [];

        // Find all parent relationships
        relations.forEach((relation: WorkItemRelation, index: number) => {
            if (relation.rel === 'System.LinkTypes.Hierarchy-Reverse') {
                parentRelationIndexes.push(index);
            }
        });

        if (parentRelationIndexes.length === 0) {
            return true; // No parent relationships to remove
        }

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems/${childId}?api-version=7.0`;
        
        // Remove from highest index to lowest to avoid index shifting issues
        const requestBody = parentRelationIndexes
            .sort((a, b) => b - a)
            .map(index => ({
                op: 'remove',
                path: `/relations/${index}`
            }));

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
                console.log(`Successfully removed ${parentRelationIndexes.length} parent relationships from ${childId}`);
                return true;
            } else {
                console.error(`Failed to remove parent relationships: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            console.error(`Error removing parent relationships: ${error.message}`);
            return false;
        }
    }

    // Remove specific parent-child relationship
    async removeParentChildRelationship(childId: number, parentId: number): Promise<boolean> {
        const workItem = await this.getSpecificWorkItem(childId);
        if (!workItem) return false;

        const relations: WorkItemRelation[] = workItem.relations || [];
        let relationIndex = -1;

        // Find the specific parent relationship
        relations.forEach((relation: WorkItemRelation, index: number) => {
            if (relation.rel === 'System.LinkTypes.Hierarchy-Reverse') {
                const relatedIdMatch = relation.url.match(/\/(\d+)$/);
                if (relatedIdMatch && parseInt(relatedIdMatch[1]) === parentId) {
                    relationIndex = index;
                }
            }
        });

        if (relationIndex === -1) {
            console.log('Parent relationship not found');
            return false;
        }

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitems/${childId}?api-version=7.0`;
        
        const requestBody = [{
            op: 'remove',
            path: `/relations/${relationIndex}`
        }];

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
                console.log(`Successfully removed parent ${parentId} from child ${childId}`);
                return true;
            } else {
                new Notice(`Failed to remove parent relationship: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            new Notice(`Error removing parent relationship: ${error.message}`);
            return false;
        }
    }

    // Get work item type definitions with icons
    async getWorkItemTypes(): Promise<any[]> {
        if (!this.validateSettings()) return [];

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitemtypes?api-version=7.0`;

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
                console.error('Failed to fetch work item types:', response.status, response.text);
                return [];
            }
        } catch (error) {
            console.error('Error fetching work item types:', error);
            return [];
        }
    }

    // Download and cache work item type icon
    async downloadWorkItemIcon(iconUrl: string, workItemType: string): Promise<string | null> {
        if (!iconUrl) {
            return null;
        }

        try {
            // For Azure DevOps icons, we need to include authorization
            const response = await requestUrl({
                url: iconUrl,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${btoa(':' + this.settings.personalAccessToken)}`,
                    'Accept': 'image/svg+xml,image/*,*/*'
                },
                throw: false
            });

            if (response.status >= 200 && response.status < 300) {
                // Handle different response types
                let iconData: string;
                
                if (response.arrayBuffer) {
                    // Convert ArrayBuffer to base64
                    const arrayBuffer = response.arrayBuffer;
                    const uint8Array = new Uint8Array(arrayBuffer);
                    
                    // Check if it's SVG by looking for SVG content
                    const textDecoder = new TextDecoder('utf-8');
                    const textContent = textDecoder.decode(uint8Array.slice(0, 100)); // Check first 100 bytes
                    
                    if (textContent.includes('<svg') || iconUrl.includes('.svg')) {
                        // It's SVG - convert to text and embed directly
                        const svgContent = textDecoder.decode(uint8Array);
                        
                        // Clean up the SVG and make it data URL compatible
                        const cleanSvg = svgContent
                            .replace(/[\r\n\t]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .replace(/>\s+</g, '><')
                            .trim();
                        
                        iconData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`;
                    } else {
                        // It's a binary image - convert to base64
                        const binaryString = Array.from(uint8Array).map(byte => String.fromCharCode(byte)).join('');
                        const base64 = btoa(binaryString);
                        
                        // Determine MIME type
                        let mimeType = 'image/png';
                        if (iconUrl.includes('.jpg') || iconUrl.includes('.jpeg')) {
                            mimeType = 'image/jpeg';
                        } else if (iconUrl.includes('.gif')) {
                            mimeType = 'image/gif';
                        } else if (iconUrl.includes('.webp')) {
                            mimeType = 'image/webp';
                        }
                        
                        iconData = `data:${mimeType};base64,${base64}`;
                    }
                } else if (response.text) {
                    // Response is already text (SVG)
                    const svgContent = response.text;
                    
                    const cleanSvg = svgContent
                        .replace(/[\r\n\t]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .replace(/>\s+</g, '><')
                        .trim();
                    
                    iconData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`;
                } else {
                    return null;
                }
                
                return iconData;
                
            } else {
                return null;
            }
        } catch (error) {
            return null;
        }
    }
}