import { WorkItemManager } from '../src/work-item-manager';
import { AzureDevOpsAPI, type WorkItem } from '../src/api';
import { AzureDevOpsSettings } from '../src/settings';
import { mockApp, TFile } from 'obsidian';
import type AzureDevOpsPlugin from '../src/main';

jest.mock('obsidian');
jest.mock('marked');
jest.mock('turndown');

describe('WorkItemManager', () => {
    let workItemManager: WorkItemManager;
    let api: AzureDevOpsAPI;
    let settings: AzureDevOpsSettings;
    let mockPlugin: Partial<AzureDevOpsPlugin>;

    const mockWorkItem: WorkItem = {
        id: 123,
        fields: {
            'System.Title': 'Test Work Item',
            'System.WorkItemType': 'Task',
            'System.State': 'New',
            'System.AssignedTo': { displayName: 'John Doe' },
            'System.CreatedDate': '2024-01-01T00:00:00.000Z',
            'System.ChangedDate': '2024-01-01T00:00:00.000Z',
            'System.Description': 'Test description',
            'System.Tags': 'tag1; tag2',
            'Microsoft.VSTS.Common.Priority': 1,
            'System.AreaPath': 'TestProject\\Area1',
            'System.IterationPath': 'TestProject\\Sprint1'
        },
        relations: []
    };

    beforeEach(() => {
        settings = {
            organization: 'test-org',
            project: 'test-project',
            personalAccessToken: 'test-token',
            useMarkdownInAzureDevOps: false,
            pendingChanges: {
                lastSaved: 0,
                changedNotes: [],
                changedRelationships: {}
            }
        };

        api = new AzureDevOpsAPI(settings);
        mockPlugin = {
            app: mockApp,
            settings
        };

        workItemManager = new WorkItemManager(
            mockApp,
            api,
            settings,
            mockPlugin as AzureDevOpsPlugin
        );

        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct dependencies', () => {
            expect(workItemManager.app).toBe(mockApp);
            expect(workItemManager.api).toBe(api);
            expect(workItemManager.settings).toBe(settings);
            expect(workItemManager.plugin).toBe(mockPlugin);
        });
    });

    describe('updateSettings', () => {
        it('should update settings', () => {
            const newSettings = { ...settings, organization: 'new-org' };
            workItemManager.updateSettings(newSettings);
            expect(workItemManager.settings).toBe(newSettings);
        });
    });

    describe('sanitizeFileName', () => {
        it('should sanitize file names correctly', () => {
            expect(workItemManager.sanitizeFileName('Test<>:"/\\|?*Title')).toBe('Test---------Title');
            expect(workItemManager.sanitizeFileName('  Spaced   Title  ')).toBe('Spaced Title');
            expect(workItemManager.sanitizeFileName('')).toBe('Untitled');
            expect(workItemManager.sanitizeFileName('a'.repeat(150))).toBe('a'.repeat(100));
        });
    });

    describe('createWorkItemNote', () => {
        it('should create well-formatted note content', async () => {
            const content = await workItemManager.createWorkItemNote(mockWorkItem);

            expect(content).toContain('---');
            expect(content).toContain('id: 123');
            expect(content).toContain('title: "Test Work Item"');
            expect(content).toContain('type: Task');
            expect(content).toContain('state: New');
            expect(content).toContain('assignedTo: John Doe');
            expect(content).toContain('# Test Work Item');
            expect(content).toContain('**Work Item ID:** 123');
            expect(content).toContain('## Description');
            expect(content).toContain('## Description');
            expect(content).toContain('[View in Azure DevOps]');
        });

        it('should handle work item with relations', async () => {
            const workItemWithRelations: WorkItem = {
                ...mockWorkItem,
                relations: [
                    {
                        rel: 'System.LinkTypes.Hierarchy-Forward',
                        url: 'https://dev.azure.com/test-org/_apis/wit/workItems/456',
                        attributes: { comment: 'Child task' }
                    }
                ]
            };

            jest.spyOn(api, 'getSpecificWorkItem').mockResolvedValue({
                id: 456,
                fields: {
                    'System.Title': 'Child Work Item',
                    'System.WorkItemType': 'Task'
                }
            });

            const content = await workItemManager.createWorkItemNote(workItemWithRelations);
            
            expect(content).toContain('**Child:** [[WI-456 Child Work Item]]');
        });

        it('should handle custom fields', async () => {
            const workItemWithCustomFields: WorkItem = {
                ...mockWorkItem,
                fields: {
                    ...mockWorkItem.fields,
                    'Custom.Field': 'Custom Value',
                    'Another.CustomField': 'Another Value'
                }
            };

            const content = await workItemManager.createWorkItemNote(workItemWithCustomFields);
            
            expect(content).toContain('## Custom Fields');
            expect(content).toContain('**Custom.Field:** Custom Value');
            expect(content).toContain('**Another.CustomField:** Another Value');
        });
    });

    describe('pullWorkItems', () => {
        it('should pull and create notes for work items', async () => {
            const mockWorkItems = [mockWorkItem];
            jest.spyOn(api, 'getWorkItems').mockResolvedValue(mockWorkItems);
            (mockApp.vault.adapter.exists as jest.Mock).mockResolvedValue(false);
            (mockApp.vault.create as jest.Mock).mockResolvedValue(new TFile('test.md'));

            await workItemManager.pullWorkItems();

            expect(api.getWorkItems).toHaveBeenCalled();
            expect(mockApp.vault.createFolder).toHaveBeenCalledWith('Azure DevOps Work Items');
            expect(mockApp.vault.create).toHaveBeenCalledWith(
                'Azure DevOps Work Items/WI-123 Test Work Item.md',
                expect.stringContaining('# Test Work Item')
            );
        });

        it('should update existing notes when pulling', async () => {
            const mockWorkItems = [mockWorkItem];
            const existingFile = new TFile('WI-123 Test Work Item.md');
            
            jest.spyOn(api, 'getWorkItems').mockResolvedValue(mockWorkItems);
            (mockApp.vault.adapter.exists as jest.Mock).mockResolvedValue(true);
            (mockApp.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(existingFile);

            await workItemManager.pullWorkItems();

            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                existingFile,
                expect.stringContaining('# Test Work Item')
            );
        });

        it('should handle empty work items list', async () => {
            jest.spyOn(api, 'getWorkItems').mockResolvedValue([]);

            await workItemManager.pullWorkItems();

            expect(mockApp.vault.create).not.toHaveBeenCalled();
        });
    });

    describe('pushSpecificWorkItem', () => {
        const mockFile = new TFile('WI-123 Test Work Item.md');
        const mockContent = `---
id: 123
title: "Updated Title"
state: In Progress
---

# Updated Title

## Description

Updated description content
`;

        beforeEach(() => {
            (mockApp.vault.read as jest.Mock).mockResolvedValue(mockContent);
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
                frontmatter: {
                    id: 123,
                    title: 'Updated Title',
                    state: 'In Progress'
                }
            });
            jest.spyOn(api, 'updateWorkItem').mockResolvedValue(true);
            jest.spyOn(api, 'getSpecificWorkItem').mockResolvedValue(null);
        });

        it('should push work item changes successfully', async () => {
            const result = await workItemManager.pushSpecificWorkItem(mockFile);

            expect(result).toBe(true);
            expect(api.updateWorkItem).toHaveBeenCalledWith(
                123,
                expect.objectContaining({
                    state: 'In Progress'
                })
            );
        });

        it('should handle files without frontmatter', async () => {
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

            const result = await workItemManager.pushSpecificWorkItem(mockFile);

            expect(result).toBe(false);
            expect(api.updateWorkItem).not.toHaveBeenCalled();
        });

        it('should handle files without work item ID', async () => {
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
                frontmatter: { title: 'Some Title' }
            });

            const result = await workItemManager.pushSpecificWorkItem(mockFile);

            expect(result).toBe(false);
            expect(api.updateWorkItem).not.toHaveBeenCalled();
        });

        it('should handle API update failures', async () => {
            jest.spyOn(api, 'updateWorkItem').mockResolvedValue(false);

            const result = await workItemManager.pushSpecificWorkItem(mockFile);

            expect(result).toBe(false);
        });
    });

    describe('pullSpecificWorkItem', () => {
        const mockFile = new TFile('WI-123 Test Work Item.md');

        it('should pull specific work item successfully', async () => {
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
                frontmatter: { id: 123 }
            });
            jest.spyOn(api, 'getSpecificWorkItem').mockResolvedValue(mockWorkItem);

            const result = await workItemManager.pullSpecificWorkItem(mockFile);

            expect(result).toBe(true);
            expect(api.getSpecificWorkItem).toHaveBeenCalledWith(123);
            expect(mockApp.vault.modify).toHaveBeenCalledWith(
                mockFile,
                expect.stringContaining('# Test Work Item')
            );
        });

        it('should handle files without frontmatter', async () => {
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

            const result = await workItemManager.pullSpecificWorkItem(mockFile);

            expect(result).toBe(false);
        });

        it('should handle API failures', async () => {
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
                frontmatter: { id: 123 }
            });
            jest.spyOn(api, 'getSpecificWorkItem').mockResolvedValue(null);

            const result = await workItemManager.pullSpecificWorkItem(mockFile);

            expect(result).toBe(false);
            expect(mockApp.vault.modify).not.toHaveBeenCalled();
        });
    });

    describe('pushCurrentWorkItem', () => {
        it('should push current active file', async () => {
            const mockFile = new TFile('WI-123 Test Work Item.md');
            (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(mockFile);
            
            jest.spyOn(workItemManager, 'pushSpecificWorkItem').mockResolvedValue(true);

            const result = await workItemManager.pushCurrentWorkItem();

            expect(result).toBe(true);
            expect(workItemManager.pushSpecificWorkItem).toHaveBeenCalledWith(mockFile);
        });

        it('should handle no active file', async () => {
            (mockApp.workspace.getActiveFile as jest.Mock).mockReturnValue(null);

            const result = await workItemManager.pushCurrentWorkItem();

            expect(result).toBe(false);
        });
    });

    describe('HTML to Markdown conversion', () => {
        it('should convert HTML tables to markdown', () => {
            const htmlTable = `
                <table>
                    <tr><th>Header 1</th><th>Header 2</th></tr>
                    <tr><td>Row 1 Col 1</td><td>Row 1 Col 2</td></tr>
                </table>
            `;

            // Access private method for testing
            const result = (workItemManager as any).htmlToMarkdown(htmlTable);
            
            expect(result).toContain('Header 1');
            expect(result).toContain('Header 2');
        });

        it('should handle basic HTML formatting', () => {
            const html = '<p><strong>Bold</strong> and <em>italic</em> text with <code>code</code></p>';
            
            const result = (workItemManager as any).htmlToMarkdown(html);
            
            expect(result).toContain('Bold');
            expect(result).toContain('italic');
            expect(result).toContain('code');
        });
    });

    describe('Markdown to HTML conversion', () => {
        it('should convert markdown tables to HTML', async () => {
            const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
            `;

            const result = await (workItemManager as any).markdownToHtml(markdown);
            
            expect(result).toContain('Header 1');
            expect(result).toContain('Cell 1');
        });

        it('should handle markdown formatting', async () => {
            const markdown = '**Bold** and *italic* text with `code`';
            
            const result = await (workItemManager as any).markdownToHtml(markdown);
            
            expect(result).toContain('Bold');
            expect(result).toContain('italic');
            expect(result).toContain('code');
        });
    });
});