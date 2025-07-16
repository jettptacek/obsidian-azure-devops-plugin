import { WorkspaceLeaf, ItemView, Menu, TFile, Notice } from 'obsidian';
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
    private isGlobalExpanded: boolean = true;
    
    // Track relationship changes
    private originalRelationships: Map<number, number | null> = new Map(); // childId -> parentId
    private changedRelationships: Map<number, number | null> = new Map(); // childId -> new parentId
    private hasUnsavedChanges: boolean = false;

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

    // Check if any nodes are expanded
    hasExpandedNodes(): boolean {
        return this.expandedNodes.size > 0;
    }

    // Check if all expandable nodes are expanded
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

    // Update toggle button text and title based on current state
    updateToggleButton(button: HTMLElement) {
        if (this.areAllExpandableNodesExpanded()) {
            button.textContent = '▶ Collapse All';
            button.title = 'Collapse all nodes';
        } else {
            button.textContent = '▼ Expand All';
            button.title = 'Expand all nodes';
        }
    }

    // Toggle between expand all and collapse all
    toggleAll(button: HTMLElement) {
        if (this.areAllExpandableNodesExpanded()) {
            this.collapseAll();
        } else {
            this.expandAll();
        }
        this.updateToggleButton(button);
    }

    // Update push button appearance based on changes
    updatePushButton(button: HTMLElement) {
        if (this.hasUnsavedChanges && this.changedRelationships.size > 0) {
            button.textContent = `Push ${this.changedRelationships.size} Change${this.changedRelationships.size !== 1 ? 's' : ''}`;
            button.className = 'mod-warning';
            button.style.backgroundColor = 'var(--interactive-accent)';
            button.style.color = 'var(--text-on-accent)';
            
            // Add a small indicator dot
            let indicator = button.querySelector('.change-indicator') as HTMLElement;
            if (!indicator) {
                indicator = button.createEl('span');
                indicator.className = 'change-indicator';
                indicator.style.position = 'absolute';
                indicator.style.top = '2px';
                indicator.style.right = '2px';
                indicator.style.width = '8px';
                indicator.style.height = '8px';
                indicator.style.backgroundColor = '#ff4757';
                indicator.style.borderRadius = '50%';
                indicator.style.fontSize = '0';
            }
        } else {
            button.textContent = 'Push Relations';
            button.className = 'mod-secondary';
            button.style.backgroundColor = '';
            button.style.color = '';
            
            // Remove indicator dot
            const indicator = button.querySelector('.change-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
    }

    // Helper to update push button if it exists
    updatePushButtonIfExists() {
        const pushBtn = this.containerEl.querySelector('button[class*="mod-warning"], button[class*="mod-secondary"]') as HTMLElement;
        if (pushBtn && (pushBtn.textContent?.includes('Push') || pushBtn.textContent?.includes('Change'))) {
            this.updatePushButton(pushBtn);
        }
    }

    async onOpen() {
        this.containerEl.empty();
        
        // Header
        const header = this.containerEl.createDiv();
        header.style.padding = '10px';
        header.style.borderBottom = '1px solid var(--background-modifier-border)';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        
        const title = header.createEl('h3');
        title.textContent = 'Azure DevOps Work Items';
        title.style.margin = '0';
        
        // Button container
        const buttonContainer = header.createDiv();
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.alignItems = 'center';
        
        // Single Expand/Collapse toggle button
        const toggleBtn = buttonContainer.createEl('button');
        toggleBtn.className = 'mod-secondary';
        toggleBtn.style.fontSize = '12px';
        toggleBtn.style.padding = '4px 8px';
        toggleBtn.style.marginRight = '8px';
        this.updateToggleButton(toggleBtn);
        toggleBtn.addEventListener('click', () => this.toggleAll(toggleBtn));

        const refreshBtn = buttonContainer.createEl('button');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.className = 'mod-cta';
        refreshBtn.addEventListener('click', () => this.refreshTreeView());

        const pushRelationsBtn = buttonContainer.createEl('button');
        pushRelationsBtn.textContent = 'Push Relations';
        pushRelationsBtn.className = 'mod-warning';
        pushRelationsBtn.style.position = 'relative';
        this.updatePushButton(pushRelationsBtn);
        pushRelationsBtn.addEventListener('click', () => this.pushChangedRelationships());

        // Instructions
        const instructions = this.containerEl.createDiv();
        instructions.style.padding = '8px 10px';
        instructions.style.backgroundColor = 'var(--background-secondary)';
        instructions.style.fontSize = '12px';
        instructions.style.color = 'var(--text-muted)';
        instructions.innerHTML = '💡 <strong>Drag & Drop:</strong> Drag work items to change parent-child relationships. Click "Push Relations" to sync changes to Azure DevOps.';

        // Tree container
        const treeContainer = this.containerEl.createDiv();
        treeContainer.style.padding = '10px';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.maxHeight = 'calc(100vh - 140px)';
        treeContainer.style.position = 'relative';
        
        this.virtualScrollContainer = treeContainer;
        
        await this.buildTreeView(treeContainer);
    }

    async refreshTreeView() {
        // Clear caches
        this.workItemTypeIcons.clear();
        this.iconLoadPromises.clear();
        this.renderedNodes.clear();
        this.nodeElements.clear();
        
        const treeContainer = this.containerEl.children[2] as HTMLElement;
        if (treeContainer) {
            treeContainer.empty();
            await this.buildTreeView(treeContainer);
        }
    }

    async buildTreeView(container: HTMLElement) {
        try {
            // Load work item type icons first
            await this.loadWorkItemTypeIcons();
            
            const workItems = await this.plugin.getWorkItemsWithRelations();
            
            if (workItems.length === 0) {
                const message = container.createEl('p');
                message.textContent = 'No work items found. Pull work items first.';
                message.style.textAlign = 'center';
                message.style.color = 'var(--text-muted)';
                return;
            }

            this.workItemsTree = this.buildWorkItemTree(workItems);
            
            // Store original relationships for change tracking
            this.storeOriginalRelationships(this.workItemsTree);
            
            // Initialize expanded state for all nodes with children
            this.initializeExpandedState(this.workItemsTree);
            
            this.renderTreeOptimized(container, this.workItemsTree);
            
            // Update toggle button after building tree
            const toggleBtn = this.containerEl.querySelector('button[title*="nodes"]') as HTMLElement;
            if (toggleBtn) {
                this.updateToggleButton(toggleBtn);
            }
            
        } catch (error) {
            const errorMsg = container.createEl('p');
            errorMsg.textContent = `Error loading work items: ${error.message}`;
            errorMsg.style.color = 'var(--text-error)';
            errorMsg.style.textAlign = 'center';
        }
    }

    // Store original relationships for change tracking
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
        this.hasUnsavedChanges = false;
        storeRelationships(nodes);
        this.updatePushButtonIfExists();
    }

    // Initialize expanded state for nodes with children
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

        // Create all nodes
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

        // Store all nodes for relationship management
        this.allNodes = nodeMap;

        // Build relationships
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

        // Get root nodes
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

    // Optimized rendering with lazy loading
    renderTreeOptimized(container: HTMLElement, nodes: WorkItemNode[], level: number = 0) {
        const fragment = document.createDocumentFragment();
        
        for (const node of nodes) {
            const nodeElement = this.createNodeElement(node, level);
            fragment.appendChild(nodeElement);
            
            // Store reference for quick access
            this.nodeElements.set(node.id, nodeElement);
            
            // Create children container
            const childrenContainer = document.createElement('div');
            childrenContainer.style.display = this.expandedNodes.has(node.id) ? 'block' : 'none';
            childrenContainer.dataset.nodeId = node.id.toString();
            childrenContainer.className = 'children-container';
            
            if (node.children.length > 0) {
                // Only render children if parent is expanded
                if (this.expandedNodes.has(node.id)) {
                    this.renderTreeOptimized(childrenContainer, node.children, level + 1);
                }
            }
            
            fragment.appendChild(childrenContainer);
        }
        
        container.appendChild(fragment);
    }

    // Create individual node element
    createNodeElement(node: WorkItemNode, level: number): HTMLElement {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '4px 0';
        row.style.marginLeft = `${level * 20}px`;
        row.style.minHeight = '32px';
        row.style.borderRadius = '4px';
        row.style.cursor = 'grab';
        row.style.position = 'relative';
        row.draggable = true;
        row.dataset.nodeId = node.id.toString();
        
        // Highlight if this node has pending changes
        this.updateNodeHighlight(row, node);
        
        // Store node reference on element
        (row as any).workItemNode = node;

        this.attachDragHandlers(row, node);
        this.attachHoverHandlers(row);

        // Expand/collapse button
        const expandBtn = this.createExpandButton(node);
        row.appendChild(expandBtn);

        // Drag handle
        const dragHandle = document.createElement('span');
        dragHandle.textContent = '⋮⋮';
        dragHandle.style.fontSize = '14px';
        dragHandle.style.color = 'var(--text-muted)';
        dragHandle.style.marginRight = '8px';
        dragHandle.style.cursor = 'grab';
        dragHandle.style.flexShrink = '0';
        row.appendChild(dragHandle);

        // Work item type icon
        const iconContainer = this.createIconContainer(node);
        row.appendChild(iconContainer);

        // Work item title with change indicator
        const titleContainer = this.createTitleContainer(node);
        row.appendChild(titleContainer);

        // State badge
        const stateBadge = this.createStateBadge(node);
        row.appendChild(stateBadge);

        // Priority badge
        if (node.priority) {
            const priorityBadge = this.createPriorityBadge(node);
            row.appendChild(priorityBadge);
        }

        // Assignee badge
        if (node.assignedTo && node.assignedTo !== 'Unassigned') {
            const assigneeBadge = this.createAssigneeBadge(node);
            row.appendChild(assigneeBadge);
        }

        // Context menu
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, node);
        });

        this.renderedNodes.add(node.id);
        return row;
    }

    // Update node highlighting based on pending changes
    updateNodeHighlight(row: HTMLElement, node: WorkItemNode) {
        const hasChange = this.changedRelationships.has(node.id);
        
        if (hasChange) {
            // Strong color highlighting for the entire work item
            row.style.backgroundColor = 'rgba(255, 193, 7, 0.2)'; // Warm amber background
            row.style.borderLeft = '4px solid #ffc107'; // Amber left border
            row.style.borderRight = '2px solid #ffc107'; // Amber right border
            row.style.boxShadow = '0 2px 8px rgba(255, 193, 7, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)';
            row.style.transform = 'translateX(2px)';
            row.style.transition = 'all 0.2s ease';
            row.style.position = 'relative';
            row.classList.add('pending-change');
            
            // Add subtle pulsing amber glow
            row.style.animation = 'amber-glow 3s ease-in-out infinite alternate';
            
        } else {
            // Remove all highlighting
            row.style.backgroundColor = '';
            row.style.borderLeft = '';
            row.style.borderRight = '';
            row.style.boxShadow = '';
            row.style.transform = '';
            row.style.transition = '';
            row.style.animation = '';
            row.style.background = '';
            row.style.backgroundSize = '';
            row.classList.remove('pending-change');
        }
    }

    // Create title container with change indicator
    createTitleContainer(node: WorkItemNode): HTMLElement {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.flexGrow = '1';
        container.style.flexShrink = '1';
        container.style.minWidth = '200px';
        container.style.marginRight = '12px';

        // Title span
        const titleSpan = this.createTitleElement(node);
        container.appendChild(titleSpan);

        // Change indicator - simple text instead of rotating icon
        if (this.changedRelationships.has(node.id)) {
            const changeIndicator = document.createElement('span');
            changeIndicator.className = 'change-indicator';
            changeIndicator.textContent = 'PENDING';
            changeIndicator.style.color = '#856404'; // Dark amber text
            changeIndicator.style.backgroundColor = '#fff3cd'; // Light amber background
            changeIndicator.style.fontSize = '10px';
            changeIndicator.style.fontWeight = 'bold';
            changeIndicator.style.padding = '2px 6px';
            changeIndicator.style.borderRadius = '10px';
            changeIndicator.style.marginLeft = '8px';
            changeIndicator.style.flexShrink = '0';
            changeIndicator.style.border = '1px solid #ffc107';
            changeIndicator.title = 'Pending relationship change - will be synced to Azure DevOps';
            changeIndicator.style.textTransform = 'uppercase';
            changeIndicator.style.letterSpacing = '0.5px';
            
            // Updated CSS animations for amber theme
            if (!document.querySelector('#pending-changes-style')) {
                const style = document.createElement('style');
                style.id = 'pending-changes-style';
                style.textContent = `
                    @keyframes amber-glow {
                        0% { 
                            box-shadow: 0 2px 8px rgba(255, 193, 7, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
                        }
                        100% { 
                            box-shadow: 0 2px 12px rgba(255, 193, 7, 0.5), inset 0 1px 0 rgba(255,255,255,0.2);
                        }
                    }
                    
                    .pending-change {
                        position: relative;
                    }
                    
                    .pending-change::before {
                        content: '';
                        position: absolute;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        width: 2px;
                        background: linear-gradient(180deg, 
                            transparent 0%, 
                            #ffc107 20%, 
                            #ffc107 80%, 
                            transparent 100%
                        );
                        animation: amber-pulse-glow 2s ease-in-out infinite alternate;
                    }
                    
                    @keyframes amber-pulse-glow {
                        0% { 
                            opacity: 0.6;
                            transform: scaleY(0.8);
                        }
                        100% { 
                            opacity: 1;
                            transform: scaleY(1);
                        }
                    }
                `;
                document.head.appendChild(style);
            }
            
            container.appendChild(changeIndicator);
        }

        return container;
    }

    createTitleElement(node: WorkItemNode): HTMLElement {
        const titleSpan = document.createElement('span');
        titleSpan.textContent = `[${node.id}] ${node.title}`;
        titleSpan.style.flexGrow = '1';
        titleSpan.style.flexShrink = '1';
        titleSpan.style.minWidth = '200px';
        titleSpan.style.cursor = 'pointer';
        titleSpan.style.fontWeight = '500';
        titleSpan.style.color = 'var(--text-normal)';
        titleSpan.style.padding = '4px 8px';
        titleSpan.style.borderRadius = '4px';
        titleSpan.style.whiteSpace = 'nowrap';
        titleSpan.style.overflow = 'hidden';
        titleSpan.style.textOverflow = 'ellipsis';

        titleSpan.addEventListener('mouseenter', () => {
            titleSpan.style.backgroundColor = 'var(--interactive-hover)';
            titleSpan.style.color = 'var(--interactive-accent)';
        });
        titleSpan.addEventListener('mouseleave', () => {
            titleSpan.style.backgroundColor = '';
            titleSpan.style.color = 'var(--text-normal)';
        });
        titleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openWorkItemNote(node);
        });

        return titleSpan;
    }

    createExpandButton(node: WorkItemNode): HTMLElement {
        const expandBtn = document.createElement('span');
        expandBtn.style.width = '20px';
        expandBtn.style.height = '20px';
        expandBtn.style.display = 'flex';
        expandBtn.style.alignItems = 'center';
        expandBtn.style.justifyContent = 'center';
        expandBtn.style.cursor = 'pointer';
        expandBtn.style.fontSize = '12px';
        expandBtn.style.color = 'var(--text-muted)';
        expandBtn.style.marginRight = '8px';
        expandBtn.style.flexShrink = '0';

        if (node.children.length > 0) {
            expandBtn.textContent = this.expandedNodes.has(node.id) ? '▼' : '▶';
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleNodeOptimized(node);
            });
        } else {
            expandBtn.textContent = '•';
            expandBtn.style.cursor = 'default';
            expandBtn.style.opacity = '0.5';
        }

        return expandBtn;
    }

    createIconContainer(node: WorkItemNode): HTMLElement {
        const iconContainer = document.createElement('span');
        iconContainer.style.width = '20px';
        iconContainer.style.height = '20px';
        iconContainer.style.display = 'flex';
        iconContainer.style.alignItems = 'center';
        iconContainer.style.justifyContent = 'center';
        iconContainer.style.marginRight = '8px';
        iconContainer.style.flexShrink = '0';

        const iconInfo = this.getWorkItemTypeIcon(node.type);
        if (iconInfo.type === 'image') {
            this.setImageIcon(iconContainer, iconInfo.value, node.type);
        } else {
            iconContainer.textContent = iconInfo.value;
            iconContainer.style.fontSize = '14px';
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
                    svgElement.style.width = '16px';
                    svgElement.style.height = '16px';
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
        const iconImg = document.createElement('img');
        iconImg.src = iconValue;
        iconImg.style.width = '16px';
        iconImg.style.height = '16px';
        iconImg.style.objectFit = 'contain';
        iconImg.alt = workItemType;
        iconImg.title = workItemType;
        container.appendChild(iconImg);
        this.addImageErrorHandling(iconImg, container, workItemType);
    }

    // Helper method for image error handling
    addImageErrorHandling(iconImg: HTMLImageElement, iconContainer: HTMLElement, workItemType: string) {
        iconImg.addEventListener('error', () => {
            console.log(`Failed to display icon for ${workItemType}, falling back to emoji`);
            iconContainer.empty();
            const emojiIcons: { [key: string]: string } = {
                'Epic': '🎯', 'Feature': '🚀', 'User Story': '📝', 'Task': '✅', 
                'Bug': '🐛', 'Issue': '⚠️', 'Test Case': '🧪', 'Requirement': '📋'
            };
            iconContainer.textContent = emojiIcons[workItemType] || '📋';
            iconContainer.style.fontSize = '14px';
            iconContainer.title = workItemType;
        });
        
        iconImg.addEventListener('load', () => {
            console.log(`Successfully displayed icon for ${workItemType}`);
        });
    }

    createStateBadge(node: WorkItemNode): HTMLElement {
        const stateBadge = document.createElement('span');
        stateBadge.textContent = node.state;
        stateBadge.style.fontSize = '10px';
        stateBadge.style.padding = '2px 6px';
        stateBadge.style.borderRadius = '10px';
        stateBadge.style.fontWeight = '600';
        stateBadge.style.textTransform = 'uppercase';
        stateBadge.style.marginRight = '6px';
        stateBadge.style.flexShrink = '0';
        stateBadge.style.whiteSpace = 'nowrap';
        
        const stateKey = node.state.toLowerCase().replace(/\s+/g, '-');
        if (['new', 'active', 'to-do'].includes(stateKey)) {
            stateBadge.style.backgroundColor = '#e3f2fd';
            stateBadge.style.color = '#1976d2';
        } else if (['resolved', 'closed', 'done'].includes(stateKey)) {
            stateBadge.style.backgroundColor = '#e8f5e8';
            stateBadge.style.color = '#2e7d32';
        } else if (stateKey === 'removed') {
            stateBadge.style.backgroundColor = '#ffebee';
            stateBadge.style.color = '#c62828';
        } else {
            stateBadge.style.backgroundColor = 'var(--background-modifier-border)';
            stateBadge.style.color = 'var(--text-muted)';
        }

        return stateBadge;
    }

    createPriorityBadge(node: WorkItemNode): HTMLElement {
        const priorityBadge = document.createElement('span');
        priorityBadge.textContent = `P${node.priority}`;
        priorityBadge.style.fontSize = '10px';
        priorityBadge.style.padding = '2px 6px';
        priorityBadge.style.borderRadius = '6px';
        priorityBadge.style.backgroundColor = 'var(--background-modifier-border)';
        priorityBadge.style.color = 'var(--text-muted)';
        priorityBadge.style.fontWeight = '600';
        priorityBadge.style.marginRight = '6px';
        priorityBadge.style.flexShrink = '0';
        priorityBadge.style.whiteSpace = 'nowrap';
        return priorityBadge;
    }

    createAssigneeBadge(node: WorkItemNode): HTMLElement {
        const assigneeBadge = document.createElement('span');
        assigneeBadge.textContent = node.assignedTo.split(' ')[0];
        assigneeBadge.style.fontSize = '10px';
        assigneeBadge.style.padding = '2px 8px';
        assigneeBadge.style.borderRadius = '10px';
        assigneeBadge.style.backgroundColor = 'var(--interactive-accent)';
        assigneeBadge.style.color = 'var(--text-on-accent)';
        assigneeBadge.style.fontWeight = '500';
        assigneeBadge.style.flexShrink = '0';
        assigneeBadge.style.whiteSpace = 'nowrap';
        return assigneeBadge;
    }

    attachDragHandlers(row: HTMLElement, node: WorkItemNode) {
        row.addEventListener('dragstart', (e) => {
            this.draggedNode = node;
            row.style.opacity = '0.5';
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/plain', node.id.toString());
        });

        row.addEventListener('dragend', () => {
            row.style.opacity = '1';
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
            if (!this.draggedNode) {
                // Don't override pending change highlighting
                if (!row.classList.contains('pending-change')) {
                    row.style.backgroundColor = 'var(--background-modifier-hover)';
                }
            }
        });
        row.addEventListener('mouseleave', () => {
            if (!this.draggedNode) {
                // Don't override pending change highlighting
                if (!row.classList.contains('pending-change')) {
                    row.style.backgroundColor = '';
                }
            }
        });
    }

    // Optimized toggle with lazy rendering
    toggleNodeOptimized(node: WorkItemNode) {
        const isExpanded = this.expandedNodes.has(node.id);
        const childrenContainer = this.virtualScrollContainer?.querySelector(
            `.children-container[data-node-id="${node.id}"]`
        ) as HTMLElement;
        
        if (!childrenContainer) return;

        if (isExpanded) {
            // Collapse
            this.expandedNodes.delete(node.id);
            childrenContainer.style.display = 'none';
        } else {
            // Expand
            this.expandedNodes.add(node.id);
            
            // Lazy load children if not already rendered
            if (childrenContainer.children.length === 0 && node.children.length > 0) {
                this.renderTreeOptimized(childrenContainer, node.children, this.getNodeLevel(node) + 1);
                // Apply highlights to newly rendered children
                setTimeout(() => this.updateAllNodeHighlights(), 0);
            }
            
            childrenContainer.style.display = 'block';
        }

        // Update expand button
        const nodeElement = this.nodeElements.get(node.id);
        if (nodeElement) {
            const expandBtn = nodeElement.querySelector('span');
            if (expandBtn && node.children.length > 0) {
                expandBtn.textContent = this.expandedNodes.has(node.id) ? '▼' : '▶';
            }
        }

        // Update toggle button in header
        const toggleBtn = this.containerEl.querySelector('button[title*="nodes"]') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    // Get node level for indentation
    getNodeLevel(node: WorkItemNode): number {
        let level = 0;
        let current = node.parent;
        while (current) {
            level++;
            current = current.parent;
        }
        return level;
    }

    // Update all node highlights after changes
    updateAllNodeHighlights() {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            this.nodeElements.forEach((element, nodeId) => {
                const node = this.allNodes.get(nodeId);
                if (node) {
                    this.updateNodeHighlight(element, node);
                    
                    // Update title container to add/remove change indicator
                    const titleContainer = element.querySelector('div[style*="flex-grow"]') as HTMLElement;
                    if (titleContainer) {
                        // Remove existing container and recreate
                        const newTitleContainer = this.createTitleContainer(node);
                        titleContainer.replaceWith(newTitleContainer);
                    }
                }
            });
            
            // Also check for any newly rendered elements that might not be in nodeElements yet
            const allRows = this.containerEl.querySelectorAll('[data-node-id]') as NodeListOf<HTMLElement>;
            allRows.forEach(row => {
                const nodeId = parseInt(row.dataset.nodeId || '0');
                if (nodeId && this.changedRelationships.has(nodeId)) {
                    const node = this.allNodes.get(nodeId);
                    if (node) {
                        this.updateNodeHighlight(row, node);
                        // Update nodeElements map to include this element
                        this.nodeElements.set(nodeId, row);
                    }
                }
            });
        }, 10);
    }

    // Expand all nodes
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
        this.isGlobalExpanded = true;
        this.refreshTreeDisplay();
        // Note: updateAllNodeHighlights() is now called automatically in refreshTreeDisplay()
        new Notice('All nodes expanded');
        
        // Update toggle button if it exists
        const toggleBtn = this.containerEl.querySelector('button[title*="nodes"]') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    // Collapse all nodes
    collapseAll() {
        this.expandedNodes.clear();
        this.isGlobalExpanded = false;
        this.refreshTreeDisplay();
        // Note: updateAllNodeHighlights() is now called automatically in refreshTreeDisplay()
        new Notice('All nodes collapsed');
        
        // Update toggle button if it exists
        const toggleBtn = this.containerEl.querySelector('button[title*="nodes"]') as HTMLElement;
        if (toggleBtn) {
            this.updateToggleButton(toggleBtn);
        }
    }

    // Relationship management methods
    changeParentChild(childNode: WorkItemNode, newParentNode: WorkItemNode) {
        // Remove from old parent
        if (childNode.parent) {
            const oldParent = childNode.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== childNode.id);
        } else {
            // Remove from root nodes
            this.workItemsTree = this.workItemsTree.filter(node => node.id !== childNode.id);
        }

        // Add to new parent
        newParentNode.children.push(childNode);
        childNode.parent = newParentNode;

        // Track the change
        const originalParentId = this.originalRelationships.get(childNode.id);
        const newParentId = newParentNode.id;
        
        if (originalParentId !== newParentId) {
            this.changedRelationships.set(childNode.id, newParentId);
            this.hasUnsavedChanges = true;
        } else {
            // If we're reverting to original, remove from changed relationships
            this.changedRelationships.delete(childNode.id);
            if (this.changedRelationships.size === 0) {
                this.hasUnsavedChanges = false;
            }
        }

        // Sort children
        this.sortNodes(newParentNode.children);

        // Refresh the tree display and update push button
        this.refreshTreeDisplay();
        this.updatePushButtonIfExists();
        // Note: updateAllNodeHighlights() is now called automatically in refreshTreeDisplay()

        const changeCount = this.changedRelationships.size;
        new Notice(`Moved [${childNode.id}] ${childNode.title} under [${newParentNode.id}] ${newParentNode.title}. ${changeCount} change${changeCount !== 1 ? 's' : ''} pending.`);
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
            element.style.borderTop = '2px solid var(--interactive-accent)';
            element.style.backgroundColor = 'var(--background-modifier-hover)';
        } else {
            element.style.borderTop = '';
            element.style.backgroundColor = '';
        }
    }

    removeAllDropIndicators() {
        const rows = this.containerEl.querySelectorAll('[draggable="true"]');
        rows.forEach(row => {
            (row as HTMLElement).style.borderTop = '';
            (row as HTMLElement).style.backgroundColor = '';
        });
    }

    async refreshTreeDisplay() {
        const treeContainer = this.containerEl.children[2] as HTMLElement;
        if (treeContainer) {
            // Clear caches
            this.renderedNodes.clear();
            this.nodeElements.clear();
            
            treeContainer.empty();
            this.renderTreeOptimized(treeContainer, this.workItemsTree);
            
            // Re-apply highlights after rendering
            setTimeout(() => this.updateAllNodeHighlights(), 0);
        }
    }

    async pushChangedRelationships() {
        if (!this.hasUnsavedChanges || this.changedRelationships.size === 0) {
            new Notice('No relationship changes to push.');
            return;
        }

        const changedItems = Array.from(this.changedRelationships.entries());
        
        try {
            new Notice(`Pushing ${changedItems.length} relationship change${changedItems.length !== 1 ? 's' : ''}...`);

            let successCount = 0;
            let errorCount = 0;

            for (const [childId, newParentId] of changedItems) {
                try {
                    if (newParentId !== null) {
                        // Add parent relationship
                        const success = await this.plugin.api.addParentChildRelationship(childId, newParentId);
                        if (success) {
                            successCount++;
                        } else {
                            errorCount++;
                            console.error(`Failed to add parent relationship: ${childId} -> ${newParentId}`);
                        }
                    } else {
                        // Remove parent relationship (make root item)
                        await this.plugin.api.removeAllParentRelationships(childId);
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Error updating relationship for work item ${childId}:`, error);
                    errorCount++;
                }
            }

            if (errorCount === 0) {
                new Notice(`Successfully pushed all ${successCount} relationship changes!`);
                // Clear change tracking since all changes were successful
                this.changedRelationships.clear();
                this.hasUnsavedChanges = false;
                
                // Update original relationships to current state
                this.storeOriginalRelationships(this.workItemsTree);
                
                // Update all node highlights
                this.updateAllNodeHighlights();
            } else {
                new Notice(`Pushed ${successCount} changes, ${errorCount} failed. Check console for details.`);
            }
            
            this.updatePushButtonIfExists();
            
            // Refresh to get latest data from Azure DevOps
            setTimeout(() => {
                this.refreshTreeView();
            }, 1000);

        } catch (error) {
            new Notice(`Error pushing relationships: ${error.message}`);
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
                        await this.plugin.pushSpecificWorkItem(file);
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
        // Remove from current parent
        if (node.parent) {
            const oldParent = node.parent;
            oldParent.children = oldParent.children.filter(child => child.id !== node.id);
            node.parent = undefined;
        }

        // Add to root if not already there
        if (!this.workItemsTree.find(n => n.id === node.id)) {
            this.workItemsTree.push(node);
            this.sortNodes(this.workItemsTree);
        }

        // Track the change
        const originalParentId = this.originalRelationships.get(node.id);
        const newParentId = null; // Root item has no parent
        
        if (originalParentId !== newParentId) {
            this.changedRelationships.set(node.id, newParentId);
            this.hasUnsavedChanges = true;
        } else {
            // If we're reverting to original, remove from changed relationships
            this.changedRelationships.delete(node.id);
            if (this.changedRelationships.size === 0) {
                this.hasUnsavedChanges = false;
            }
        }

        this.refreshTreeDisplay();
        this.updatePushButtonIfExists();
        // Note: updateAllNodeHighlights() is now called automatically in refreshTreeDisplay()
        
        const changeCount = this.changedRelationships.size;
        new Notice(`Made [${node.id}] ${node.title} a root item. ${changeCount} change${changeCount !== 1 ? 's' : ''} pending.`);
    }

    async onClose() {
        // Cleanup
        this.renderedNodes.clear();
        this.nodeElements.clear();
        this.expandedNodes.clear();
        this.originalRelationships.clear();
        this.changedRelationships.clear();
    }

    // Load work item type icons from Azure DevOps
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
            
            // Wait for all icon downloads to complete
            if (iconPromises.length > 0) {
                await Promise.allSettled(iconPromises);
            }
            
            // Clean up promises
            this.iconLoadPromises.clear();
            
        } catch (error) {
            console.error('Error loading work item type icons:', error);
        }
    }

    // Get work item type icon (real icon from Azure DevOps or fallback)
    getWorkItemTypeIcon(workItemType: string): { type: 'image' | 'text', value: string } {
        // Check if we have a real icon from Azure DevOps
        const realIcon = this.workItemTypeIcons.get(workItemType);
        if (realIcon) {
            return { type: 'image', value: realIcon };
        }
        
        // Fallback to emoji icons
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

    // Debug method to check icon loading status
    debugIconStatus() {
        console.log('=== ICON DEBUG STATUS ===');
        console.log('Cached icons:', Array.from(this.workItemTypeIcons.entries()));
        console.log('Pending icon downloads:', Array.from(this.iconLoadPromises.keys()));
        
        // Test if we can access Azure DevOps API
        this.plugin.api.getWorkItemTypes().then((types: any[]) => {
            console.log('Available work item types from API:');
            types.forEach((type: any) => {
                console.log(`- ${type.name}: icon URL = ${type.icon?.url || 'NO ICON URL'}`);
            });
            
            if (types.length === 0) {
                console.error('❌ No work item types returned from API - check your connection and permissions');
            } else if (types.every((type: any) => !type.icon?.url)) {
                console.warn('⚠️ No work item types have icon URLs - your Azure DevOps project may not have icons configured');
            } else {
                console.log('✅ Found work item types with icon URLs');
            }
        }).catch((error: any) => {
            console.error('❌ Failed to fetch work item types:', error);
        });
    }
}