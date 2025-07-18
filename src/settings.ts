export interface AzureDevOpsSettings {
    organization: string;
    project: string;
    personalAccessToken: string;
    useMarkdownInAzureDevOps: boolean;
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