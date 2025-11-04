import { Notice, requestUrl } from 'obsidian';
import { AzureDevOpsSettings} from './settings';

interface WorkItemRelation {
    rel: string;
    url: string;
    attributes?: {
        comment?: string;
        name?: string;
    };
}

export interface WorkItemData {
    workItemType?: string;
    type?: string;
    title: string;
    description?: string;
    state?: string;
    assignedTo?: string;
    priority?: number;
    tags?: string;
    areaPath?: string;
    iterationPath?: string;
    customFields?: Record<string, any>;
}

interface WorkItemType {
    name: string;
    isDisabled?: boolean;
}

interface WorkItemField {
    referenceName: string;
    name: string;
    type: string;
    usage?: string;
}

export interface WorkItem {
    id: number;
    fields: Record<string, unknown>;
    relations?: WorkItemRelation[];
    _links?: unknown;
    fieldFormats?: Record<string, { format: string }>;
}

interface WorkItemUpdates {
    title?: string;
    description?: string;
    descriptionFormat?: string;
    state?: string;
    assignedTo?: string;
    priority?: number;
    tags?: string;
    customFields?: Record<string, any>;
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

    async createWorkItem(workItemData: WorkItemData): Promise<WorkItem | null> {
        if (!this.validateSettings()) return null;

        const workItemType = workItemData.workItemType || workItemData.type;
        const title = workItemData.title;
        const description = workItemData.description || '';

        const workItemTypeEncoded = encodeURIComponent(workItemType || '');
        const projectEncoded = encodeURIComponent(this.settings.project);
        const url = `https://dev.azure.com/${this.settings.organization}/${projectEncoded}/_apis/wit/workitems/$${workItemTypeEncoded}?api-version=7.0`;

        const requestBody = [
            {
                op: 'add',
                path: '/fields/System.Title',
                value: title
            }
        ];

        // Add description if provided
        if (description && description.trim() !== '') {
            requestBody.push({
                op: 'add',
                path: '/fields/System.Description',
                value: description
            });
        }

        // Add state if provided
        if (workItemData.state) {
            requestBody.push({
                op: 'add',
                path: '/fields/System.State',
                value: workItemData.state
            });
        }

        // Add assigned to if provided
        if (workItemData.assignedTo) {
            requestBody.push({
                op: 'add',
                path: '/fields/System.AssignedTo',
                value: workItemData.assignedTo
            });
        }

        // Add priority if provided
        if (workItemData.priority) {
            requestBody.push({
                op: 'add',
                path: '/fields/Microsoft.VSTS.Common.Priority',
                value: workItemData.priority?.toString() || ''
            });
        }

        // Add tags if provided
        if (workItemData.tags) {
            requestBody.push({
                op: 'add',
                path: '/fields/System.Tags',
                value: workItemData.tags
            });
        }

        // Add area path if provided
        if (workItemData.areaPath) {
            requestBody.push({
                op: 'add',
                path: '/fields/System.AreaPath',
                value: workItemData.areaPath
            });
        }

        // Add iteration path if provided
        if (workItemData.iterationPath) {
            requestBody.push({
                op: 'add',
                path: '/fields/System.IterationPath',
                value: workItemData.iterationPath
            });
        }

        // Add custom fields if provided
        if (workItemData.customFields) {
            for (const [fieldName, fieldValue] of Object.entries(workItemData.customFields)) {
                if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
                    requestBody.push({
                        op: 'add',
                        path: `/fields/${fieldName}`,
                        value: fieldValue
                    });
                }
            }
        }

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
                new Notice(`API Error ${response.status}`);
                return null;
            }
        } catch (error) {
            console.error('Request failed:', error);
            new Notice(`Request failed: ${(error as Error).message}`);
            return null;
        }
    }

    async getWorkItemTypes(): Promise<WorkItemType[]> {
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
                const workItemTypes = response.json.value || [];
                
                // Filter out types that shouldn't be created manually
                return workItemTypes.filter((type: any) => {
                    // Filter out disabled types
                    if (type.isDisabled) return false;
                    
                    // Filter out system/internal types that users shouldn't create
                    const excludedTypes = [
                        'Test Suite',
                        'Test Plan', 
                        'Shared Steps',
                        'Code Review Request',
                        'Code Review Response',
                        'Feedback Request',
                        'Feedback Response',
                        'Test Result',
                        'Test Run'
                    ];
                    
                    return !excludedTypes.some(excluded => 
                        type.name.toLowerCase().includes(excluded.toLowerCase())
                    );
                });
            } else {
                console.error('Failed to fetch work item types:', response.status, response.text);
                return [];
            }
        } catch (error) {
            console.error('Error fetching work item types:', error);
            return [];
        }
    }

    validateWorkItemData(workItemData: WorkItemData): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!workItemData.title || workItemData.title.trim() === '') {
            errors.push('Title is required');
        }
        
        if (!workItemData.workItemType || workItemData.workItemType.trim() === '') {
            errors.push('Work item type is required');
        }
        
        // Check title length (Azure DevOps has a limit)
        if (workItemData.title && workItemData.title.length > 255) {
            errors.push('Title must be 255 characters or less');
        }
        
        // Check description length if provided
        if (workItemData.description && workItemData.description.length > 32000) {
            errors.push('Description must be 32,000 characters or less');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    async getWorkItemTypeDetails(typeName: string): Promise<WorkItemType | null> {
        if (!this.validateSettings()) return null;

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitemtypes/${encodeURIComponent(typeName)}?api-version=7.0`;
        
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
                console.error(`Failed to get work item type details for ${typeName}:`, response.status, response.text);
                return null;
            }
        } catch (error) {
            console.error(`Error getting work item type details for ${typeName}:`, error);
            return null;
        }
    }

    async getWorkItemsWithRelations(): Promise<WorkItem[]> {
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
        const workItemIds = queryResult.workItems.map((wi: { id: number }) => wi.id);

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
            new Notice(`Error fetching work items: ${(error as Error).message}`);
            return [];
        }
    }

    async getWorkItems(): Promise<WorkItem[]> {
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
            const workItemIds = queryResult.workItems.map((wi: { id: number }) => wi.id);

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
                        // Process each work item to add field format information
                        const processedWorkItems = batchResult.value.map((workItem: WorkItem) => {
                            // Add field format information if available in the response
                            if (workItem.fields && workItem._links) {
                                // Initialize fieldFormats if not present
                                if (!workItem.fieldFormats) {
                                    workItem.fieldFormats = {};
                                }
                                
                                // If the user has enabled markdown mode, and the description field exists,
                                // mark it as markdown format for processing
                                if (this.settings.useMarkdownInAzureDevOps && workItem.fields['System.Description']) {
                                    workItem.fieldFormats['System.Description'] = { format: 'Markdown' };
                                }
                            }
                            return workItem;
                        });
                        
                        allWorkItems.push(...processedWorkItems);
                    }
                } else {
                    new Notice(`Failed to fetch work item details for batch: ${detailsResponse.status}`);
                }
            }

            return allWorkItems;

        } catch (error) {
            console.error('Error fetching work items:', error);
            new Notice(`Error fetching work items: ${(error as Error).message}`);
            return [];
        }
    }

    // Get a specific work item by ID
    async getSpecificWorkItem(workItemId: number): Promise<WorkItem | null> {
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
                const workItem = response.json;
                
                // Add field format information if available in the response
                if (workItem.fields && workItem._links) {
                    // Initialize fieldFormats if not present
                    if (!workItem.fieldFormats) {
                        workItem.fieldFormats = {};
                    }
                    
                    // If the user has enabled markdown mode, and the description field exists,
                    // mark it as markdown format for processing
                    if (this.settings.useMarkdownInAzureDevOps && workItem.fields['System.Description']) {
                        workItem.fieldFormats['System.Description'] = { format: 'Markdown' };
                    }
                }
                
                return workItem;
            } else {
                new Notice(`Failed to fetch work item: ${workItemId} : ${response.status}`);
                console.error(`Failed to fetch work item: ${response.status} - ${response.text}`);
                return null;
            }
        } catch (error) {
            new Notice(`Error fetching work item: ${(error as Error).message}`);
            return null;
        }
    }

    // Update work item in Azure DevOps
    async updateWorkItem(workItemId: number, updates: WorkItemUpdates): Promise<boolean> {
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

        if (Object.prototype.hasOwnProperty.call(updates, 'tags')) {
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

        // Handle custom fields
        if (updates.customFields) {
            for (const [fieldName, fieldValue] of Object.entries(updates.customFields)) {
                if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
                    // Remove empty custom fields
                    requestBody.push({
                        op: 'remove',
                        path: `/fields/${fieldName}`
                    });
                } else {
                    // Add or update custom field
                    requestBody.push({
                        op: 'replace',
                        path: `/fields/${fieldName}`,
                        value: fieldValue
                    });
                }
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
                console.error(`Push failed: ${response.status} - ${response.text}`);
                new Notice(`Push failed: ${response.status}`);
                return false;
            }
        } catch (error) {
            console.error('Push failed:', error);
            new Notice(`Push failed: ${(error as Error).message}`);
            return false;
        }
    }

    // Get all field definitions for the project (useful for custom field discovery)
    async getWorkItemFields(): Promise<WorkItemField[]> {
        if (!this.validateSettings()) return [];

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/fields?api-version=7.0`;

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
                console.error('Failed to fetch work item fields:', response.status, response.text);
                return [];
            }
        } catch (error) {
            console.error('Error fetching work item fields:', error);
            return [];
        }
    }

    // Get field definitions for a specific work item type
    async getWorkItemTypeFields(workItemType: string): Promise<WorkItemField[]> {
        if (!this.validateSettings()) return [];

        const url = `https://dev.azure.com/${this.settings.organization}/${encodeURIComponent(this.settings.project)}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields?api-version=7.0`;

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
                console.error(`Failed to fetch fields for work item type ${workItemType}:`, response.status, response.text);
                return [];
            }
        } catch (error) {
            console.error(`Error fetching fields for work item type ${workItemType}:`, error);
            return [];
        }
    }

    // Validate custom field before updating
    async validateCustomField(fieldName: string, fieldValue: unknown): Promise<boolean> {
        if (!this.validateSettings()) return false;

        try {
            // Get all available fields
            const allFields = await this.getWorkItemFields();
            
            // Check if the field exists
            const field = allFields.find(f => f.referenceName === fieldName || f.name === fieldName);
            
            if (!field) {
                console.warn(`Custom field ${fieldName} not found in project fields`);
                return false;
            }

            // Basic type validation
            switch (field.type) {
                case 'Integer':
                    return !isNaN(parseInt(String(fieldValue)));
                case 'Double':
                    return !isNaN(parseFloat(String(fieldValue)));
                case 'Boolean':
                    return typeof fieldValue === 'boolean' || fieldValue === 'true' || fieldValue === 'false';
                case 'String':
                case 'PlainText':
                case 'Html':
                    return typeof fieldValue === 'string';
                case 'DateTime':
                    return !isNaN(Date.parse(String(fieldValue)));
                default:
                    return true; // Allow other types
            }
        } catch (error) {
            console.error('Error validating custom field:', error);
            return true; // Allow if validation fails
        }
    }

    // Get custom field definitions (non-system fields)
    async getCustomFields(): Promise<WorkItemField[]> {
        if (!this.validateSettings()) return [];

        try {
            const allFields = await this.getWorkItemFields();
            
            // Filter to custom fields (non-system fields)
            return allFields.filter(field => 
                !field.referenceName.startsWith('System.') &&
                !field.referenceName.startsWith('Microsoft.VSTS.Common.') &&
                !field.referenceName.startsWith('Microsoft.VSTS.Scheduling.') &&
                !field.referenceName.startsWith('Microsoft.VSTS.TCM.') &&
                field.usage !== 'WorkItemTypeExtension' // Exclude internal fields
            );
        } catch (error) {
            console.error('Error fetching custom fields:', error);
            return [];
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
                url: `https://dev.azure.com/${this.settings.organization}/_apis/wit/workItems/${String(parentId)}`,
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
                return true;
            } else {
                new Notice(`Failed to add parent relationship: ${parentId} : ${response.status}`);
                console.error(`Failed to add parent relationship: ${response.status} - ${response.text}`)
                return false;
            }
        } catch (error) {
            new Notice(`Error adding parent relationship: ${(error as Error).message}`);
            console.error(`Error adding parent relationship:`, error);
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
                return true;
            } else {
                console.error(`Failed to remove parent relationships: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            console.error(`Error removing parent relationships: ${(error as Error).message}`);
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
                return true;
            } else {
                
                new Notice(`Failed to remove parent relationship: ${childId} : ${response.status}`);
                console.error(`Failed to remove parent relationship: ${response.status} - ${response.text}`);
                return false;
            }
        } catch (error) {
            new Notice(`Error removing parent relationship: ${(error as Error).message}`);
            console.error(`Error removing parent relationship:`, error);
            return false;
        }
    }

    // Download and cache work item type icon
    async downloadWorkItemIcon(iconUrl: string): Promise<string | null> {
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
        } catch {
            return null;
        }
    }
}