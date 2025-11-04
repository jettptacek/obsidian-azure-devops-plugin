export class Notice {
    constructor(public message: string, public timeout?: number) {}
    setMessage(message: string) {
        this.message = message;
    }
    hide() {}
}

export class Plugin {
    app!: App;
    manifest!: any;
    
    onload() {}
    onunload() {}
    addCommand(command: any) {}
    addRibbonIcon(icon: string, title: string, callback: () => void) {}
    addSettingTab(tab: any) {}
    registerView(viewType: string, factory: (leaf: WorkspaceLeaf) => any) {}
    registerEvent(event: any) {}
    loadData(): Promise<any> {
        return Promise.resolve({});
    }
    saveData(data: any): Promise<void> {
        return Promise.resolve();
    }
}

export class TFile {
    constructor(public path: string, public name: string = '') {}
    basename = '';
    extension = '';
    stat = { mtime: 0, ctime: 0, size: 0 };
}

export class WorkspaceLeaf {
    setViewState(state: any): Promise<void> {
        return Promise.resolve();
    }
}

export class Modal {
    app!: App;
    contentEl!: HTMLElement;
    
    constructor(app: App) {
        this.app = app;
        this.contentEl = document.createElement('div');
    }
    
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
}

export interface App {
    workspace: Workspace;
    vault: Vault;
    metadataCache: MetadataCache;
}

export interface Workspace {
    getActiveFile(): TFile | null;
    getLeavesOfType(type: string): WorkspaceLeaf[];
    revealLeaf(leaf: WorkspaceLeaf): void;
    getRightLeaf(split: boolean): WorkspaceLeaf;
    on(event: string, callback: (...args: any[]) => void): any;
}

export interface Vault {
    read(file: TFile): Promise<string>;
    modify(file: TFile, content: string): Promise<void>;
    create(path: string, content: string): Promise<TFile>;
    createFolder(path: string): Promise<void>;
    getAbstractFileByPath(path: string): TFile | null;
    adapter: VaultAdapter;
}

export interface VaultAdapter {
    exists(path: string): Promise<boolean>;
}

export interface MetadataCache {
    getFileCache(file: TFile): CachedMetadata | null;
}

export interface CachedMetadata {
    frontmatter?: FrontMatterCache;
}

export interface FrontMatterCache {
    [key: string]: any;
}

export const requestUrl = jest.fn().mockResolvedValue({
    status: 200,
    json: {},
    text: '',
    arrayBuffer: new ArrayBuffer(0)
});

export const mockApp: App = {
    workspace: {
        getActiveFile: jest.fn().mockReturnValue(null),
        getLeavesOfType: jest.fn().mockReturnValue([]),
        revealLeaf: jest.fn(),
        getRightLeaf: jest.fn().mockReturnValue(new WorkspaceLeaf()),
        on: jest.fn()
    },
    vault: {
        read: jest.fn().mockResolvedValue(''),
        modify: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue(new TFile('test.md')),
        createFolder: jest.fn().mockResolvedValue(undefined),
        getAbstractFileByPath: jest.fn().mockReturnValue(null),
        adapter: {
            exists: jest.fn().mockResolvedValue(false)
        }
    },
    metadataCache: {
        getFileCache: jest.fn().mockReturnValue(null)
    }
};