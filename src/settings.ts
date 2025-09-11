export interface PendingChangesData {
    changedNotes: number[];
    changedRelationships: { [workItemId: number]: number | null };
    lastSaved: number; // timestamp
}

export interface AzureDevOpsSettings {
    organization: string;
    project: string;
    personalAccessToken: string;
    useMarkdownInAzureDevOps: boolean;
    pendingChanges?: PendingChangesData;
}

export const DEFAULT_SETTINGS: AzureDevOpsSettings = {
    organization: '',
    project: '',
    personalAccessToken: '',
    useMarkdownInAzureDevOps: false
};

export interface WorkItem {
    title: string;
    description: string;
    workItemType: string;
}

export interface WorkItemRelation {
    rel: string;
    url: string;
    attributes?: {
        name?: string;
    };
}

export interface WorkItemNode {
    id: number;
    title: string;
    type: string;
    state: string;
    assignedTo: string;
    priority: string;
    children: WorkItemNode[];
    parent?: WorkItemNode;
    filePath?: string;
}

export interface AzureDevOpsWorkItem {
    id: number;
    fields: {
        [key: string]: any;
        'System.Title': string;
        'System.WorkItemType': string;
        'System.State': string;
        'System.AssignedTo'?: { displayName: string };
        'System.CreatedDate'?: string;
        'System.ChangedDate'?: string;
        'System.Tags'?: string;
        'System.Description'?: string;
        'Microsoft.VSTS.Common.Priority'?: number;
        'System.AreaPath'?: string;
        'System.IterationPath'?: string;
    };
    relations?: WorkItemRelation[];
    fieldFormats?: {
        [key: string]: { format: string };
    };
    _links?: any;
}

export interface WorkItemType {
    name: string;
    description?: string;
    isDisabled?: boolean;
    icon?: {
        url: string;
    };
}

export interface HTMLElementWithWorkItem extends HTMLElement {
    workItemNode?: WorkItemNode;
}

export interface WorkItemUpdate {
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

export interface RelatedWorkItem {
    id: number;
    title: string;
    type: string;
}