import { WorkspaceLeaf, ItemView, Menu, TFile, Notice, FileView } from 'obsidian';
import { WorkItemNode, WorkItemRelation } from './settings';

export const VIEW_TYPE_AZURE_DEVOPS_TREE = 'azure-devops-tree-view';

export class AzureDevOpsTreeView extends ItemView {
    plugin: any;
    workItemsTree: WorkItemNode[] = [];
    draggedNode: WorkItemNode | null = null;
    allNodes: Map<number, WorkItemNode> = new Map();
    workItemTypeIcons: Map<string, string> = new Map();
    iconLoadPromises: Map<string, Promise<string | null>> = new Map();
    
    // Performance optimization properties
    private renderedNodes: Set<number> = new Set();
    private expandedNodes: Set<number> = new Set();
    private nodeElements: Map<number, HTMLElement> = new Map();
    private virtualScrollContainer: HTMLElement | null = null;
    
    // Track relationship changes
    private originalRelationships: Map<number, number | null> = new Map();
    private changedRelationships: Map<number, number | null> = new Map();

    // Track content changes in addition to relationship changes
    private originalNoteContent: Map<number, string> = new Map();
    private changedNotes: Set<number> = new Set();
    private fileWatcher: any = null;

    // Auto-scroll and navigation properties
    private activeFileWatcher: any = null;

    constructor(leaf: WorkspaceLeaf, plugin: any) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_AZURE_DEVOPS_TREE;
    }

    getDisplayText(): string {
        return 'Azure DevOps Tree';
    }

    getIcon(): string {
        return 'git-branch';
    }

    startActiveFileWatcher() {
        if (this.activeFileWatcher) {
            this.app.workspace.offref(this.activeFileWatcher);
        }
        
        // Watch for active file changes
        this.activeFileWatcher = this.app.workspace.on('active-leaf-change', (leaf) => {
            if (leaf && leaf.view instanceof FileView && leaf.view.file) {
                this.handleActiveFileChange(leaf.view.file);
            }
        });
        
        // Watch for file-open events
        this.app.workspace.on('file-open', (file) => {
            if (file) {
                this.handleActiveFileChange(file);
            }
        });
        
        // Watch for when files are opened via clicking in file explorer, command palette, etc.
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (file) {
                    setTimeout(() => {
                        this.handleActiveFileChange(file);
                    }, 100);
                }
            })
        );
    }

    async handleActiveFileChange(file: TFile) {
        // Check if this is a work item file
        if (!file.path.startsWith('Azure DevOps Work Items/') || !file.path.endsWith('.md')) {
            return;
        }
        
        // Extract work item ID from filename
        const match = file.name.match(/^WI-(\d+)/);
        if (!match) {
            return;
        }
        
        const workItemId = parseInt(match[1]);
        
        // Find and scroll to this work item in the tree
        await this.scrollToWorkItem(workItemId);
    }

    async scrollToWorkItem(workItemId: number, highlightItem: boolean = true) {
        const node = this.allNodes.get(workItemId);
        if (!node) {
            console.warn(`Work item ${workItemId} not found in tree`);
            return;
        }
        
        await this.expandPathToNode(node);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const nodeElement = this.nodeElements.get(workItemId);
        if (!nodeElement) {
            console.warn(`DOM element for work item ${workItemId} not found`);
            return;
        }
        
        // Scroll the element into view with optional highlighting
        this.scrollElementIntoView(nodeElement, highlightItem);
    }

    async expandPathToNode(targetNode: WorkItemNode) {
        const pathToRoot: WorkItemNode[] = [];
        let currentNode: WorkItemNode | undefined = targetNode;
        
        while (currentNode) {
            pathToRoot.unshift(currentNode);
            currentNode = currentNode.parent;
        }
        
        for (let i = 0; i < pathToRoot.length - 1; i++) {
            const nodeToExpand = pathToRoot[i];
            
            if (nodeToExpand.children.length > 0 && !this.expandedNodes.has(nodeToExpand.id)) {
                this.expandedNodes.add(nodeToExpand.id);
                
                const nodeElement = this.nodeElements.get(nodeToExpand.id);
                if (nodeElement) {
                    const expandBtn = nodeElement.querySelector('span');
                    if (expandBtn && nodeToExpand.children.length > 0) {
                        expandBtn.textContent = '▼';
                    }
                }
                
                const childrenContainer = this.virtualScrollContainer?.querySelector(
                    `.children-container[data-node-id="${nodeToExpand.id}"]`
                ) as HTMLElement;
                
                if (childrenContainer) {
                    if (childrenContainer.children.length === 0 && nodeToExpand.children.length > 0) {
                        this.renderTreeOptimized(childrenContainer, nodeToExpand.children, this.getNodeLevel(nodeToExpand) + 1);
                    }
                    childrenContainer.addClass('azure-tree-children-visible');
                }
            }
        }
        
        const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    scrollElementIntoView(element: HTMLElement, highlightOnScroll: boolean = false) {
        const treeContainer = this.virtualScrollContainer;
        if (!treeContainer) {
            return;
        }
        
        const elementRect = element.getBoundingClientRect();
        const containerRect = treeContainer.getBoundingClientRect();
        
        const isElementVisible = (
            elementRect.top >= containerRect.top &&
            elementRect.bottom <= containerRect.bottom
        );
        
        if (!isElementVisible) {
            const elementTop = element.offsetTop;
            const containerHeight = treeContainer.clientHeight;
            const elementHeight = element.offsetHeight;
            
            const scrollTop = elementTop - (containerHeight / 2) + (elementHeight / 2);
            
            treeContainer.scrollTo({
                top: Math.max(0, scrollTop),
                behavior: 'smooth'
            });
        }
        
        if (highlightOnScroll) {
            this.highlightElement(element);
        }
    }

    highlightElement(element: HTMLElement) {
        const hadPendingChange = element.classList.contains('azure-tree-pending-change');
        
        const existingHighlights = this.containerEl.querySelectorAll('.azure-tree-active-file-highlight, .azure-tree-active-file-fade');
        existingHighlights.forEach(el => {
            el.classList.remove('azure-tree-active-file-highlight', 'azure-tree-active-file-fade');
        });
        
        element.classList.add('azure-tree-active-file-highlight');
        
        setTimeout(() => {
            element.classList.remove('azure-tree-active-file-highlight');
            element.classList.add('azure-tree-active-file-fade');
            
            setTimeout(() => {
                element.classList.remove('azure-tree-active-file-fade');
                
                if (hadPendingChange) {
                    element.classList.add('azure-tree-pending-change');
                }
            }, 600);
        }, 2000);
    }

    areAllExpandableNodesExpanded(): boolean {
        const getAllExpandableNodes = (nodes: WorkItemNode[]): WorkItemNode[] => {
            let expandableNodes: WorkItemNode[] = [];
            for (const node of nodes) {
                if (node.children.length > 0) {
                    expandableNodes.push(node);
                    expandableNodes = expandableNodes.concat(getAllExpandableNodes(node.children));
                }
            }
            return expandableNodes;
        };

        const allExpandableNodes = getAllExpandableNodes(this.workItemsTree);
        return allExpandableNodes.length > 0 && allExpandableNodes.every(node => this.expandedNodes.has(node.id));
    }

    updateToggleButton(button: HTMLElement) {
        if (this.areAllExpandableNodesExpanded()) {
            button.textContent = '▶ Collapse All';
            button.title = 'Collapse all nodes';
        } else {
            button.textContent = '▼ Expand All';
            button.title = 'Expand all nodes';
        }
    }

    toggleAll(button: HTMLElement) {
        if (this.areAllExpandableNodesExpanded()) {
            this.collapseAll();
        } else {
            this.expandAll();
        }
        this.updateToggleButton(button);
    }

    updatePushButton(button: HTMLElement) {
        const totalChanges = this.changedRelationships.size + this.changedNotes.size;
        const hasAnyChanges = totalChanges > 0;
        
        if (hasAnyChanges) {
            const relChanges = this.changedRelationships.size;
            const contentChanges = this.changedNotes.size;
            
            let buttonText = `Push ${totalChanges} Change${totalChanges !== 1 ? 's' : ''}`;
            let titleText = '';
            
            if (relChanges > 0 && contentChanges > 0) {
                titleText = `${relChanges} relationship change${relChanges !== 1 ? 's' : ''} and ${contentChanges} content change${contentChanges !== 1 ? 's' : ''}`;
            } else if (relChanges > 0) {
                titleText = `${relChanges} relationship change${relChanges !== 1 ? 's' : ''}`;
            } else {
                titleText = `${contentChanges} content change${contentChanges !== 1 ? 's' : ''}`;
            }
            
            button.textContent = buttonText;
            button.title = titleText;
            button.className = 'mod-warning azure-tree-push-button azure-tree-push-button--has-changes';
            
            let indicator = button.querySelector('.azure-tree-change-indicator') as HTMLElement;
            if (!indicator) {
                indicator = button.createEl('span', { cls: 'azure-tree-change-indicator' });
            }
        } else {
            button.textContent = 'Push Changes';
            button.title = 'No pending changes';
            button.className = 'mod-secondary azure-tree-push-button';
            
            const indicator = button.querySelector('.azure-tree-change-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
    }

    updatePushButtonIfExists() {
        const pushBtn = this.containerEl.querySelector('.azure-tree-push-button, .azure-tree-push-button--has-changes') as HTMLElement;
        if (pushBtn) {
            this.updatePushButton(pushBtn);
        }
    }

    async onOpen() {
        this.containerEl.empty();
        this.containerEl.addClass('azure-devops-tree-view');
        
        // Header
        const header = this.containerEl.createDiv('azure-tree-header');
        
        const title = header.createEl('h3', {
            text: 'Azure DevOps Work Items',
            cls: 'azure-tree-title'
        });
        
        // Button container
        const buttonContainer = header.createDiv('azure-tree-button-container');
        
        // Toggle button
        const toggleBtn = buttonContainer.createEl('button', {
            cls: 'mod-secondary toggle-all-btn azure-tree-control-btn'
        });
        this.updateToggleButton(toggleBtn);
        toggleBtn.addEventListener('click', () => this.toggleAll(toggleBtn));

        const refreshBtn = buttonContainer.createEl('button', {
            text: 'Refresh',
            cls: 'mod-cta azure-tree-control-btn'
        });
        refreshBtn.addEventListener('click', () => this.refreshTreeView());

        const pushChangesBtn = buttonContainer.createEl('button', {
            text: 'Push Changes',
            cls: 'mod-warning azure-tree-push-button'
        });
        this.updatePushButton(pushChangesBtn);
        pushChangesBtn.addEventListener('click', () => this.pushAllChanges());

        // Tree container
        const treeContainer = this.containerEl.createDiv('azure-tree-container');
        this.virtualScrollContainer = treeContainer;
        
        await this.buildTreeView(treeContainer);

        this.startActiveFileWatcher();
    }

    async refreshTreeView() {
        const currentChangedNotes = new Set(this.changedNotes);
        const currentOriginalContent = new Map(this.originalNoteContent);
        
        this.workItemTypeIcons.clear();
        this.iconLoadPromises.clear();
        this.renderedNodes.clear();
        this.nodeElements.clear();
        
        const treeContainer = this.containerEl.querySelector('.azure-tree-container') as HTMLElement;
        if (treeContainer) {
            treeContainer.empty();
            await this.buildTreeViewPreservingChanges(treeContainer, currentChangedNotes, currentOriginalContent);
        }
    }

    async buildTreeView(container: HTMLElement) {
        try {
            await this.loadWorkItemTypeIcons();
            
            const workItems = await this.plugin.getWorkItemsWithRelations();
            
            if (workItems.length === 0) {
                const message = container.createEl('p', {
                    text: 'No work items found. Pull work items first.',
                    cls: 'azure-tree-empty-message'
                });
                return;
            }

            this.workItemsTree = this.buildWorkItemTree(workItems);
            this.storeOriginalRelationships(this.workItemsTree);
            
            await this.storeOriginalNoteContent(this.workItemsTree);
            await this.detectNoteChanges(this.workItemsTree);
            
            this.initializeExpandedState(this.workItemsTree);
            this.renderTreeOptimized(container, this.workItemsTree);
            
            this.startFileWatcher();
            
            const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
            if (toggleBtn) {
                this.updateToggleButton(toggleBtn);
            }
            
        } catch (error) {
            const errorMsg = container.createEl('p', {
                text: `Error loading work items: ${error.message}`,
                cls: 'azure-tree-error-message'
            });
        }
    }

    async buildTreeViewPreservingChanges(container: HTMLElement, preservedChangedNotes: Set<number>, preservedOriginalContent: Map<number, string>) {
        try {
            await this.loadWorkItemTypeIcons();
            
            const workItems = await this.plugin.getWorkItemsWithRelations();
            
            if (workItems.length === 0) {
                const message = container.createEl('p', {
                    text: 'No work items found. Pull work items first.',
                    cls: 'azure-tree-empty-message'
                });
                return;
            }

            this.workItemsTree = this.buildWorkItemTree(workItems);
            this.storeOriginalRelationships(this.workItemsTree);
            
            await this.storeOriginalNoteContentPreservingChanges(this.workItemsTree, preservedOriginalContent);
            
            this.changedNotes = preservedChangedNotes;
            
            await this.detectNoteChanges(this.workItemsTree);
            
            this.initializeExpandedState(this.workItemsTree);
            this.renderTreeOptimized(container, this.workItemsTree);
            
            this.startFileWatcher();
            
            const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
            if (toggleBtn) {
                this.updateToggleButton(toggleBtn);
            }
            
        } catch (error) {
            const errorMsg = container.createEl('p', {
                text: `Error loading work items: ${error.message}`,
                cls: 'azure-tree-error-message'
            });
        }
    }

    async storeOriginalNoteContent(nodes: WorkItemNode[]) {
        const storeContent = async (nodeList: WorkItemNode[]) => {
            for (const node of nodeList) {
                if (node.filePath) {
                    try {
                        const file = this.app.vault.getAbstractFileByPath(node.filePath);
                        if (file instanceof TFile) {
                            const content = await this.app.vault.read(file);
                            this.originalNoteContent.set(node.id, content);
                        }
                    } catch (error) {
                        console.warn(`Could not read file for work item ${node.id}:`, error);
                    }
                }
                
                if (node.children.length > 0) {
                    await storeContent(node.children);
                }
            }
        };
        
        await storeContent(nodes);
    }

    async storeOriginalNoteContentPreservingChanges(nodes: WorkItemNode[], preservedOriginalContent: Map<number, string>) {
        const storeContent = async (nodeList: WorkItemNode[]) => {
            for (const node of nodeList) {
                if (node.filePath) {
                    try {
                        if (preservedOriginalContent.has(node.id)) {
                            this.originalNoteContent.set(node.id, preservedOriginalContent.get(node.id)!);
                        } else {
                            const file = this.app.vault.getAbstractFileByPath(node.filePath);
                            if (file instanceof TFile) {
                                const content = await this.app.vault.read(file);
                                this.originalNoteContent.set(node.id, content);
                            }
                        }
                    } catch (error) {
                        console.warn(`Could not read file for work item ${node.id}:`, error);
                    }
                }
                
                if (node.children.length > 0) {
                    await storeContent(node.children);
                }
            }
        };
        
        await storeContent(nodes);
    }

    async detectNoteChanges(nodes: WorkItemNode[]) {
        const detectChanges = async (nodeList: WorkItemNode[]) => {
            for (const node of nodeList) {
                if (node.filePath) {
                    try {
                        const file = this.app.vault.getAbstractFileByPath(node.filePath);
                        if (file instanceof TFile) {
                            const currentContent = await this.app.vault.read(file);
                            const originalContent = this.originalNoteContent.get(node.id);
                            
                            if (originalContent && this.hasContentChanged(originalContent, currentContent)) {
                                this.changedNotes.add(node.id);
                            } else {
                                this.changedNotes.delete(node.id);
                            }
                        }
                    } catch (error) {
                        console.warn(`Could not check changes for work item ${node.id}:`, error);
                    }
                }
                
                if (node.children.length > 0) {
                    await detectChanges(node.children);
                }
            }
        };
        
        this.changedNotes.clear();
        await detectChanges(nodes);
    }

    hasContentChanged(original: string, current: string): boolean {
        const normalize = (content: string) => {
            return content
                .replace(/\*Last (pulled|pushed): .*\*/g, '')
                .replace(/synced: .*$/m, '')
                .replace(/\s+/g, ' ')
                .trim();
        };
        
        const normalizedOriginal = normalize(original);
        const normalizedCurrent = normalize(current);
        
        return normalizedOriginal !== normalizedCurrent;
    }

    startFileWatcher() {
        if (this.fileWatcher) {
            this.app.vault.offref(this.fileWatcher);
        }
        
        this.fileWatcher = this.app.vault.on('modify', async (file: TFile) => {
            if (file.path.startsWith('Azure DevOps Work Items/') && file.path.endsWith('.md')) {
                const match = file.name.match(/^WI-(\d+)/);
                if (match) {
                    const workItemId = parseInt(match[1]);
                    await this.checkSingleNoteChange(workItemId, file);
                }
            }
        });
    }

    async checkSingleNoteChange(workItemId: number, file: TFile) {
        try {
            const currentContent = await this.app.vault.read(file);
            const originalContent = this.originalNoteContent.get(workItemId);
            
            if (originalContent) {
                const hasChanged = this.hasContentChanged(originalContent, currentContent);
                
                if (hasChanged) {
                    this.changedNotes.add(workItemId);
                } else {
                    this.changedNotes.delete(workItemId);
                }
                
                await this.updateNodeVisualState(workItemId);
                this.updatePushButtonIfExists();
            }
        } catch (error) {
            console.warn(`Error checking changes for work item ${workItemId}:`, error);
        }
    }

    async updateNodeVisualState(workItemId: number) {
        const nodeElement = this.nodeElements.get(workItemId);
        if (nodeElement) {
            const hasRelationshipChange = this.changedRelationships.has(workItemId);
            const hasContentChange = this.changedNotes.has(workItemId);
            const hasPendingChanges = hasRelationshipChange || hasContentChange;
            
            if (hasPendingChanges) {
                nodeElement.classList.add('azure-tree-pending-change');
            } else {
                nodeElement.classList.remove('azure-tree-pending-change');
            }
            
            const titleContainer = nodeElement.querySelector('.azure-tree-title-container') as HTMLElement;
            if (titleContainer) {
                const existingBadge = titleContainer.querySelector('.azure-tree-pending-badge');
                if (existingBadge) {
                    existingBadge.remove();
                }
                
                if (hasPendingChanges) {
                    const badge = titleContainer.createEl('span', { cls: 'azure-tree-pending-badge' });
                    
                    if (hasRelationshipChange && hasContentChange) {
                        badge.textContent = 'PENDING (REL + CONTENT)';
                        badge.title = 'Pending relationship and content changes';
                        badge.addClass('azure-tree-pending-badge--both');
                    } else if (hasRelationshipChange) {
                        badge.textContent = 'PENDING (REL)';
                        badge.title = 'Pending relationship change';
                        badge.addClass('azure-tree-pending-badge--relationship');
                    } else {
                        badge.textContent = 'PENDING (CONTENT)';
                        badge.title = 'Pending content changes';
                        badge.addClass('azure-tree-pending-badge--content');
                    }
                }
            }
        }
    }

    storeOriginalRelationships(nodes: WorkItemNode[]) {
        const storeRelationships = (nodeList: WorkItemNode[], parentId: number | null = null) => {
            for (const node of nodeList) {
                this.originalRelationships.set(node.id, parentId);
                if (node.children.length > 0) {
                    storeRelationships(node.children, node.id);
                }
            }
        };
        
        this.originalRelationships.clear();
        this.changedRelationships.clear();
        storeRelationships(nodes);
        this.updatePushButtonIfExists();
    }

    initializeExpandedState(nodes: WorkItemNode[]) {
        const traverse = (nodeList: WorkItemNode[]) => {
            for (const node of nodeList) {
                if (node.children.length > 0) {
                    this.expandedNodes.add(node.id);
                    traverse(node.children);
                }
            }
        };
        traverse(nodes);
    }

    buildWorkItemTree(workItems: any[]): WorkItemNode[] {
        const nodeMap = new Map<number, WorkItemNode>();
        const rootNodes: WorkItemNode[] = [];

        for (const workItem of workItems) {
            const fields = workItem.fields;
            const node: WorkItemNode = {
                id: workItem.id,
                title: fields['System.Title'] || 'Untitled',
                type: fields['System.WorkItemType'] || 'Unknown',
                state: fields['System.State'] || 'Unknown',
                assignedTo: fields['System.AssignedTo']?.displayName || 'Unassigned',
                priority: fields['Microsoft.VSTS.Common.Priority']?.toString() || '',
                children: [],
                filePath: this.getWorkItemFilePath(workItem.id, fields['System.Title'])
            };
            nodeMap.set(workItem.id, node);
        }

        this.allNodes = nodeMap;

        for (const workItem of workItems) {
            const node = nodeMap.get(workItem.id);
            if (!node) continue;

            const relations = workItem.relations || [];
            const parentRelation = relations.find((rel: WorkItemRelation) => 
                rel.rel === 'System.LinkTypes.Hierarchy-Reverse'
            );

            if (parentRelation) {
                const parentIdMatch = parentRelation.url.match(/\/(\d+)$/);
                if (parentIdMatch) {
                    const parentId = parseInt(parentIdMatch[1]);
                    const parentNode = nodeMap.get(parentId);
                    if (parentNode) {
                        parentNode.children.push(node);
                        node.parent = parentNode;
                    }
                }
            }
        }

        for (const node of nodeMap.values()) {
            if (!node.parent) {
                rootNodes.push(node);
            }
        }

        this.sortNodes(rootNodes);
        return rootNodes;
    }

    sortNodes(nodes: WorkItemNode[]) {
        const typePriority: { [key: string]: number } = {
            'Epic': 1, 'Feature': 2, 'User Story': 3, 'Task': 4, 'Bug': 5, 'Issue': 6
        };
        
        nodes.sort((a, b) => {
            const aPriority = typePriority[a.type] || 7;
            const bPriority = typePriority[b.type] || 7;
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.title.localeCompare(b.title);
        });
        
        nodes.forEach(node => {
            if (node.children.length > 0) {
                this.sortNodes(node.children);
            }
        });
    }

    renderTreeOptimized(container: HTMLElement, nodes: WorkItemNode[], level: number = 0) {
        const fragment = document.createDocumentFragment();
        
        for (const node of nodes) {
            const nodeElement = this.createNodeElement(node, level);
            fragment.appendChild(nodeElement);
            
            this.nodeElements.set(node.id, nodeElement);
            
            const childrenContainer = document.createElement('div');
            childrenContainer.addClass('azure-tree-children-container');
            if (!this.expandedNodes.has(node.id)) {
                childrenContainer.addClass('azure-tree-children-hidden');
            }
            childrenContainer.dataset.nodeId = node.id.toString();
            
            if (node.children.length > 0) {
                if (this.expandedNodes.has(node.id)) {
                    this.renderTreeOptimized(childrenContainer, node.children, level + 1);
                }
            }
            
            fragment.appendChild(childrenContainer);
        }
        
        container.appendChild(fragment);
    }

    createNodeElement(node: WorkItemNode, level: number): HTMLElement {
        const row = document.createElement('div');
        row.className = 'azure-tree-row';
        row.classList.add(`azure-tree-level-${level}`);
        row.draggable = true;
        row.dataset.nodeId = node.id.toString();
        
        // Always check for current pending changes state
        const hasRelationshipChange = this.changedRelationships.has(node.id);
        const hasContentChange = this.changedNotes.has(node.id);
        
        // Apply highlighting if there are pending changes
        if (hasRelationshipChange || hasContentChange) {
            row.classList.add('azure-tree-pending-change');
        }
        
        (row as any).workItemNode = node;

        this.attachDragHandlers(row, node);
        this.attachHoverHandlers(row);

        const expandBtn = this.createExpandButton(node);
        row.appendChild(expandBtn);

        const dragHandle = row.createEl('span', {
            text: '⋮⋮',
            cls: 'azure-tree-drag-handle'
        });

        const iconContainer = this.createIconContainer(node);
        row.appendChild(iconContainer);

        const titleContainer = this.createTitleElement(node);
        row.appendChild(titleContainer);

        const stateBadge = this.createStateBadge(node);
        row.appendChild(stateBadge);

        if (node.priority) {
            const priorityBadge = this.createPriorityBadge(node);
            row.appendChild(priorityBadge);
        }

        if (node.assignedTo && node.assignedTo !== 'Unassigned') {
            const assigneeBadge = this.createAssigneeBadge(node);
            row.appendChild(assigneeBadge);
        }

        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, node);
        });

        this.renderedNodes.add(node.id);
        return row;
    }

    createTitleElement(node: WorkItemNode): HTMLElement {
        const container = document.createElement('div');
        container.className = 'azure-tree-title-container';

        const titleSpan = container.createEl('span', {
            text: `[${node.id}] ${node.title}`,
            cls: 'azure-tree-title-text'
        });

        titleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openWorkItemNote(node);
        });

        const hasRelationshipChange = this.changedRelationships.has(node.id);
        const hasContentChange = this.changedNotes.has(node.id);
        
        if (hasRelationshipChange || hasContentChange) {
            const badge = container.createEl('span', { cls: 'azure-tree-pending-badge' });
            
            if (hasRelationshipChange && hasContentChange) {
                badge.textContent = 'PENDING (REL + CONTENT)';
                badge.title = 'Pending relationship and content changes - will be synced to Azure DevOps';
                badge.addClass('azure-tree-pending-badge--both');
            } else if (hasRelationshipChange) {
                badge.textContent = 'PENDING (REL)';
                badge.title = 'Pending relationship change - will be synced to Azure DevOps';
                badge.addClass('azure-tree-pending-badge--relationship');
            } else {
                badge.textContent = 'PENDING (CONTENT)';
                badge.title = 'Pending content changes - will be synced to Azure DevOps';
                badge.addClass('azure-tree-pending-badge--content');
            }
        }

        return container;
    }

    createExpandButton(node: WorkItemNode): HTMLElement {
        const expandBtn = document.createElement('span');
        expandBtn.className = 'azure-tree-expand-button';

        if (node.children.length > 0) {
            expandBtn.textContent = this.expandedNodes.has(node.id) ? '▼' : '▶';
            expandBtn.addClass('azure-tree-expand-button--expandable');
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNodeOptimized(node);
            });
        } else {
            expandBtn.textContent = '•';
            expandBtn.addClass('azure-tree-expand-button--leaf');
        }

        return expandBtn;
    }

    createIconContainer(node: WorkItemNode): HTMLElement {
        const iconContainer = document.createElement('span');
        iconContainer.className = 'azure-tree-icon-container';

        const iconInfo = this.getWorkItemTypeIcon(node.type);
        if (iconInfo.type === 'image') {
            this.setImageIcon(iconContainer, iconInfo.value, node.type);
        } else {
            iconContainer.textContent = iconInfo.value;
            iconContainer.title = node.type;
        }

        return iconContainer;
    }

    setImageIcon(container: HTMLElement, iconValue: string, workItemType: string) {
        if (iconValue.startsWith('data:image/svg+xml')) {
            const svgData = iconValue.split(',')[1];
            const svgContent = decodeURIComponent(svgData);
            
            try {
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
                const svgElement = svgDoc.documentElement;
                
                if (svgElement && svgElement.tagName === 'svg') {
                    svgElement.setAttribute('width', '16');
                    svgElement.setAttribute('height', '16');
                    svgElement.addClass('azure-tree-icon-svg');
                    container.appendChild(svgElement);
                } else {
                    throw new Error('Invalid SVG content');
                }
            } catch (error) {
                this.setFallbackImage(container, iconValue, workItemType);
            }
        } else {
            this.setFallbackImage(container, iconValue, workItemType);
        }
    }

    setFallbackImage(container: HTMLElement, iconValue: string, workItemType: string) {
        const iconImg = container.createEl('img', {
            cls: 'azure-tree-icon-image'
        });
        iconImg.src = iconValue;
        iconImg.alt = workItemType;
        iconImg.title = workItemType;
        this.addImageErrorHandling(iconImg, container, workItemType);
    }

    addImageErrorHandling(iconImg: HTMLImageElement, iconContainer: HTMLElement, workItemType: string) {
        iconImg.addEventListener('error', () => {
            console.warn(`Failed to display icon for ${workItemType}, falling back to emoji`);
            iconContainer.empty();
            const emojiIcons: { [key: string]: string } = {
                'Epic': '🎯', 'Feature': '🚀', 'User Story': '📝', 'Task': '✅', 
                'Bug': '🐛', 'Issue': '⚠️', 'Test Case': '🧪', 'Requirement': '📋'
            };
            iconContainer.textContent = emojiIcons[workItemType] || '📋';
            iconContainer.title = workItemType;
        });
    }

    createStateBadge(node: WorkItemNode): HTMLElement {
        const stateBadge = document.createElement('span');
        stateBadge.textContent = node.state;
        stateBadge.className = 'azure-tree-state-badge';
        
        const stateKey = node.state.toLowerCase().replace(/\s+/g, '-');
        if (['new', 'active', 'to-do'].includes(stateKey)) {
            stateBadge.addClass('azure-tree-state-badge--active');
        } else if (['resolved', 'closed', 'done'].includes(stateKey)) {
            stateBadge.addClass('azure-tree-state-badge--completed');
        } else if (stateKey === 'removed') {
            stateBadge.addClass('azure-tree-state-badge--removed');
        } else {
            stateBadge.addClass('azure-tree-state-badge--default');
        }

        return stateBadge;
    }

    createPriorityBadge(node: WorkItemNode): HTMLElement {
        const priorityBadge = document.createElement('span');
        priorityBadge.textContent = `P${node.priority}`;
        priorityBadge.className = 'azure-tree-priority-badge';
        return priorityBadge;
    }

    createAssigneeBadge(node: WorkItemNode): HTMLElement {
        const assigneeBadge = document.createElement('span');
        assigneeBadge.textContent = node.assignedTo.split(' ')[0];
        assigneeBadge.className = 'azure-tree-assignee-badge';
        return assigneeBadge;
    }

    attachDragHandlers(row: HTMLElement, node: WorkItemNode) {
        row.addEventListener('dragstart', (e) => {
            this.draggedNode = node;
            row.addClass('azure-tree-row--dragging');
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/plain', node.id.toString());
        });

        row.addEventListener('dragend', () => {
            row.removeClass('azure-tree-row--dragging');
            this.draggedNode = null;
            this.removeAllDropIndicators();
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'move';
            
            if (this.draggedNode && this.draggedNode.id !== node.id && !this.isDescendant(this.draggedNode, node)) {
                this.showDropIndicator(row, true);
            }
        });

        row.addEventListener('dragleave', () => {
            this.showDropIndicator(row, false);
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            this.showDropIndicator(row, false);
            
            if (this.draggedNode && this.draggedNode.id !== node.id && !this.isDescendant(this.draggedNode, node)) {
                this.changeParentChild(this.draggedNode, node);
            }
        });
    }

    attachHoverHandlers(row: HTMLElement) {
        row.addEventListener('mouseenter', () => {
            if (!this.draggedNode && !row.classList.contains('azure-tree-pending-change')) {
                row.addClass('azure-tree-row--hover');
            }
        });
        row.addEventListener('mouseleave', () => {
            row.removeClass('azure-tree-row--hover');
        });
    }

    toggleNodeOptimized(node: WorkItemNode) {
        const isExpanded = this.expandedNodes.has(node.id);
        const childrenContainer = this.virtualScrollContainer?.querySelector(
            `.azure-tree-children-container[data-node-id="${node.id}"]`
        ) as HTMLElement;
        
        if (!childrenContainer) return;

        if (isExpanded) {
            this.expandedNodes.delete(node.id);
            childrenContainer.addClass('azure-tree-children-hidden');
        } else {
            this.expandedNodes.add(node.id);
            
            if (childrenContainer.children.length === 0 && node.children.length > 0) {
                this.renderTreeOptimized(childrenContainer, node.children, this.getNodeLevel(node) + 1);
            }
            
            childrenContainer.removeClass('azure-tree-children-hidden');
        }

        const nodeElement = this.nodeElements.get(node.id);
        if (nodeElement) {
            const expandBtn = nodeElement.querySelector('.azure-tree-expand-button');
            if (expandBtn && node.children.length > 0) {
                expandBtn.textContent = this.expandedNodes.has(node.id) ? '▼' : '▶';
            }
        }

        const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    getNodeLevel(node: WorkItemNode): number {
        let level = 0;
        let current = node.parent;
        while (current) {
            level++;
            current = current.parent;
        }
        return level;
    }

    expandAll() {
        const expandAllNodes = (nodes: WorkItemNode[]) => {
            for (const node of nodes) {
                if (node.children.length > 0) {
                    this.expandedNodes.add(node.id);
                    expandAllNodes(node.children);
                }
            }
        };

        expandAllNodes(this.workItemsTree);
        this.refreshTreeDisplay();
        
        const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    collapseAll() {
        this.expandedNodes.clear();
        this.refreshTreeDisplay();
        
        const toggleBtn = this.containerEl.querySelector('.toggle-all-btn') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    changeParentChild(childNode: WorkItemNode, newParentNode: WorkItemNode) {
        if (childNode.parent) {
            const oldParent = childNode.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== childNode.id);
        } else {
            this.workItemsTree = this.workItemsTree.filter(node => node.id !== childNode.id);
        }

        newParentNode.children.push(childNode);
        childNode.parent = newParentNode;

        const originalParentId = this.originalRelationships.get(childNode.id);
        const newParentId = newParentNode.id;
        
        if (originalParentId !== newParentId) {
            this.changedRelationships.set(childNode.id, newParentId);
        } else {
            this.changedRelationships.delete(childNode.id);
        }

        this.sortNodes(newParentNode.children);
        this.refreshTreeDisplay();
        this.updatePushButtonIfExists();

        const totalChanges = this.changedRelationships.size + this.changedNotes.size;
        new Notice(`Moved [${childNode.id}] ${childNode.title} under [${newParentNode.id}] ${newParentNode.title}. ${totalChanges} change${totalChanges !== 1 ? 's' : ''} pending.`);
    }

    isDescendant(ancestor: WorkItemNode, potential: WorkItemNode): boolean {
        let current = potential.parent;
        while (current) {
            if (current.id === ancestor.id) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    showDropIndicator(element: HTMLElement, show: boolean) {
        if (show) {
            element.addClass('azure-tree-row--drop-target');
        } else {
            element.removeClass('azure-tree-row--drop-target');
        }
    }

    removeAllDropIndicators() {
        const rows = this.containerEl.querySelectorAll('[draggable="true"]');
        rows.forEach(row => {
            row.removeClass('azure-tree-row--drop-target');
        });
    }

    async refreshTreeDisplay() {
        const treeContainer = this.containerEl.querySelector('.azure-tree-container') as HTMLElement;
        if (treeContainer) {
            this.renderedNodes.clear();
            this.nodeElements.clear();
            
            treeContainer.empty();
            this.renderTreeOptimized(treeContainer, this.workItemsTree);
        }
    }

    async pushAllChanges() {
        const totalChanges = this.changedRelationships.size + this.changedNotes.size;
        
        if (totalChanges === 0) {
            new Notice('No changes to push.');
            return;
        }

        try {
            new Notice(`Pushing ${totalChanges} change${totalChanges !== 1 ? 's' : ''}...`);

            let successCount = 0;
            let errorCount = 0;

            if (this.changedRelationships.size > 0) {
                const changedItems = Array.from(this.changedRelationships.entries());
                
                for (const [childId, newParentId] of changedItems) {
                    try {
                        if (newParentId !== null) {
                            const success = await this.plugin.api.addParentChildRelationship(childId, newParentId);
                            if (success) {
                                successCount++;
                            } else {
                                errorCount++;
                            }
                        } else {
                            await this.plugin.api.removeAllParentRelationships(childId);
                            successCount++;
                        }
                    } catch (error) {
                        console.error(`Error updating relationship for work item ${childId}:`, error);
                        errorCount++;
                    }
                }
            }

            if (this.changedNotes.size > 0) {
                for (const workItemId of this.changedNotes) {
                    try {
                        const node = this.allNodes.get(workItemId);
                        if (node && node.filePath) {
                            const file = this.app.vault.getAbstractFileByPath(node.filePath);
                            if (file instanceof TFile) {
                                const success = await this.plugin.workItemManager.pushSpecificWorkItem(file);
                                if (success) {
                                    successCount++;
                                    const newContent = await this.app.vault.read(file);
                                    this.originalNoteContent.set(workItemId, newContent);
                                    this.changedNotes.delete(workItemId);
                                } else {
                                    errorCount++;
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`Error pushing content for work item ${workItemId}:`, error);
                        errorCount++;
                    }
                }
            }

            if (errorCount === 0) {
                new Notice(`Successfully pushed all changes!`);
                this.changedRelationships.clear();
                this.storeOriginalRelationships(this.workItemsTree);
            } else {
                new Notice(`Pushed ${successCount} changes, ${errorCount} failed. Check console for details.`);
            }
            
            this.updatePushButtonIfExists();
            
            setTimeout(() => {
                this.refreshTreeView();
            }, 1000);

        } catch (error) {
            new Notice(`Error pushing changes: ${error.message}`);
        }
    }

    getWorkItemFilePath(id: number, title: string): string {
        const safeTitle = this.plugin.sanitizeFileName(title);
        return `Azure DevOps Work Items/WI-${id} ${safeTitle}.md`;
    }

    async openWorkItemNote(node: WorkItemNode) {
        if (!node.filePath) return;
        
        const file = this.app.vault.getAbstractFileByPath(node.filePath);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        } else {
            new Notice(`Work item note not found. Pull work items to create it.`);
        }
    }

    showContextMenu(event: MouseEvent, node: WorkItemNode) {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle('Open Work Item')
                .setIcon('external-link')
                .onClick(() => this.openWorkItemNote(node));
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Make Root Item')
                .setIcon('arrow-up')
                .onClick(() => this.makeRootItem(node));
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('Pull from Azure DevOps')
                .setIcon('download')
                .onClick(async () => {
                    const file = this.app.vault.getAbstractFileByPath(node.filePath || '');
                    if (file instanceof TFile) {
                        await this.plugin.pullSpecificWorkItem(file);
                        // Update the cached content after pull
                        await this.updateSpecificWorkItemChanges(node.id, file);
                    } else {
                        new Notice('Work item note not found. Pull all work items first.');
                    }
                });
        });

        menu.addItem((item) => {
            item.setTitle('Push to Azure DevOps')
                .setIcon('upload')
                .onClick(async () => {
                    const file = this.app.vault.getAbstractFileByPath(node.filePath || '');
                    if (file instanceof TFile) {
                        let successCount = 0;
                        let errorCount = 0;
                        let operations = 0;

                        // Push parent-child relationship changes if any
                        if (this.changedRelationships.has(node.id)) {
                            operations++;
                            try {
                                const newParentId = this.changedRelationships.get(node.id);
                                
                                if (newParentId !== null) {
                                    const success = await this.plugin.api.addParentChildRelationship(node.id, newParentId);
                                    if (success) {
                                        successCount++;
                                        this.changedRelationships.delete(node.id);
                                    } else {
                                        errorCount++;
                                    }
                                } else {
                                    await this.plugin.api.removeAllParentRelationships(node.id);
                                    successCount++;
                                    this.changedRelationships.delete(node.id);
                                }
                            } catch (error) {
                                console.error(`Error updating relationship for work item ${node.id}:`, error);
                                errorCount++;
                            }
                        }

                        // Push content changes if any
                        if (this.changedNotes.has(node.id)) {
                            operations++;
                            try {
                                const success = await this.plugin.workItemManager.pushSpecificWorkItem(file);
                                if (success) {
                                    successCount++;
                                    // Update the cached content after successful push
                                    const newContent = await this.app.vault.read(file);
                                    this.originalNoteContent.set(node.id, newContent);
                                    this.changedNotes.delete(node.id);
                                } else {
                                    errorCount++;
                                }
                            } catch (error) {
                                console.error(`Error pushing content for work item ${node.id}:`, error);
                                errorCount++;
                            }
                        }

                        // If no changes detected, still try to push content
                        if (operations === 0) {
                            operations++;
                            try {
                                const success = await this.plugin.workItemManager.pushSpecificWorkItem(file);
                                if (success) {
                                    successCount++;
                                    // Update the cached content after successful push
                                    const newContent = await this.app.vault.read(file);
                                    this.originalNoteContent.set(node.id, newContent);
                                    this.changedNotes.delete(node.id);
                                } else {
                                    errorCount++;
                                }
                            } catch (error) {
                                console.error(`Error pushing work item ${node.id}:`, error);
                                errorCount++;
                            }
                        }

                        // Update the visual state and UI
                        await this.updateNodeVisualState(node.id);
                        this.updatePushButtonIfExists();

                        // Show appropriate notice
                        if (errorCount === 0) {
                            new Notice(`Successfully pushed all changes for work item ${node.id}`);
                        } else if (successCount > 0) {
                            new Notice(`Partially pushed work item ${node.id}: ${successCount} succeeded, ${errorCount} failed`);
                        } else {
                            new Notice(`Failed to push work item ${node.id}`);
                        }
                    } else {
                        new Notice('Work item note not found.');
                    }
                });
        });

        menu.addSeparator();

        menu.addItem((item) => {
            item.setTitle('View in Azure DevOps')
                .setIcon('external-link')
                .onClick(() => {
                    const url = `https://dev.azure.com/${this.plugin.settings.organization}/${encodeURIComponent(this.plugin.settings.project)}/_workitems/edit/${node.id}`;
                    window.open(url, '_blank');
                });
        });

        menu.showAtMouseEvent(event);
    }

    makeRootItem(node: WorkItemNode) {
        if (node.parent) {
            const oldParent = node.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== node.id);
            node.parent = undefined;
        }

        if (!this.workItemsTree.find(n => n.id === node.id)) {
            this.workItemsTree.push(node);
            this.sortNodes(this.workItemsTree);
        }

        const originalParentId = this.originalRelationships.get(node.id);
        const newParentId = null;
        
        if (originalParentId !== newParentId) {
            this.changedRelationships.set(node.id, newParentId);
        } else {
            this.changedRelationships.delete(node.id);
        }

        this.refreshTreeDisplay();
        this.updatePushButtonIfExists();
        
        const totalChanges = this.changedRelationships.size + this.changedNotes.size;
        new Notice(`Made [${node.id}] ${node.title} a root item. ${totalChanges} change${totalChanges !== 1 ? 's' : ''} pending.`);
    }

    async refreshChangeDetection() {
        await this.storeOriginalNoteContent(this.workItemsTree);
        await this.detectNoteChanges(this.workItemsTree);
        await this.refreshTreeDisplay();
        this.updatePushButtonIfExists();
    }

    async updateSpecificWorkItemChanges(workItemId: number, file: TFile) {
        try {
            const newContent = await this.app.vault.read(file);
            this.originalNoteContent.set(workItemId, newContent);
            
            this.changedNotes.delete(workItemId);
            
            await this.updateNodeVisualState(workItemId);
            this.updatePushButtonIfExists();
            
            console.log(`Updated change detection for work item ${workItemId}`);
        } catch (error) {
            console.error(`Error updating change detection for work item ${workItemId}:`, error);
        }
    }

    async onClose() {
        if (this.activeFileWatcher) {
            this.app.workspace.offref(this.activeFileWatcher);
            this.activeFileWatcher = null;
        }

        if (this.fileWatcher) {
            this.app.vault.offref(this.fileWatcher);
        }
        
        this.renderedNodes.clear();
        this.nodeElements.clear();
        this.expandedNodes.clear();
        this.originalRelationships.clear();
        this.changedRelationships.clear();
        this.originalNoteContent.clear();
        this.changedNotes.clear();
    }

    async loadWorkItemTypeIcons() {
        try {
            const workItemTypes = await this.plugin.api.getWorkItemTypes();
            const iconPromises = [];
            
            for (const workItemType of workItemTypes) {
                const typeName = workItemType.name;
                const iconUrl = workItemType.icon?.url;
                
                if (iconUrl && !this.workItemTypeIcons.has(typeName)) {
                    if (!this.iconLoadPromises.has(typeName)) {
                        const iconPromise = this.plugin.api.downloadWorkItemIcon(iconUrl, typeName)
                            .then((iconDataUrl: string | null) => {
                                if (iconDataUrl) {
                                    this.workItemTypeIcons.set(typeName, iconDataUrl);
                                }
                                return iconDataUrl;
                            })
                            .catch((error: any) => {
                                console.error(`Error loading icon for ${typeName}:`, error);
                                return null;
                            });
                        
                        this.iconLoadPromises.set(typeName, iconPromise);
                        iconPromises.push(iconPromise);
                    }
                }
            }
            
            if (iconPromises.length > 0) {
                await Promise.allSettled(iconPromises);
            }
            
            this.iconLoadPromises.clear();
            
        } catch (error) {
            console.error('Error loading work item type icons:', error);
        }
    }

    getWorkItemTypeIcon(workItemType: string): { type: 'image' | 'text', value: string } {
        const realIcon = this.workItemTypeIcons.get(workItemType);
        if (realIcon) {
            return { type: 'image', value: realIcon };
        }
        
        const emojiIcons: { [key: string]: string } = {
            'Epic': '🎯',
            'Feature': '🚀',
            'User Story': '📝',
            'Task': '✅',
            'Bug': '🐛',
            'Issue': '⚠️',
            'Test Case': '🧪',
            'Requirement': '📋',
            'Risk': '⚠️',
            'Impediment': '🚧'
        };
        
        return { type: 'text', value: emojiIcons[workItemType] || '📋' };
    }
}