import { AzureDevOpsAPI } from '../src/api';
import { WorkItemManager } from '../src/work-item-manager';
import { AzureDevOpsSettings } from '../src/settings';
import { mockApp, requestUrl } from 'obsidian';
import type AzureDevOpsPlugin from '../src/main';

jest.mock('obsidian');

describe('Integration Tests', () => {
    let api: AzureDevOpsAPI;
    let workItemManager: WorkItemManager;
    let settings: AzureDevOpsSettings;
    let mockPlugin: Partial<AzureDevOpsPlugin>;
    const mockRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;

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

    describe('End-to-End Work Item Creation Flow', () => {
        it('should create work item and generate note file', async () => {
            // Mock API responses for creation
            const mockCreatedWorkItem = {
                id: 123,
                fields: {
                    'System.Title': 'Integration Test Item',
                    'System.WorkItemType': 'Task',
                    'System.State': 'New',
                    'System.Description': 'Test description',
                    'System.CreatedDate': '2024-01-01T00:00:00.000Z',
                    'System.ChangedDate': '2024-01-01T00:00:00.000Z'
                }
            };

            mockRequestUrl.mockResolvedValue({
                status: 201,
                json: mockCreatedWorkItem
            });

            (mockApp.vault.adapter.exists as jest.Mock).mockResolvedValue(false);

            // Create work item
            const workItemData = {
                title: 'Integration Test Item',
                workItemType: 'Task',
                description: 'Test description'
            };

            const createdItem = await api.createWorkItem(workItemData);
            expect(createdItem).toBeDefined();
            expect(createdItem!.id).toBe(123);

            // Generate note content
            const noteContent = await workItemManager.createWorkItemNote(createdItem!);
            
            expect(noteContent).toContain('id: 123');
            expect(noteContent).toContain('# Integration Test Item');
            expect(noteContent).toContain('## Description');
        });
    });

    describe('Pull and Push Workflow', () => {
        it('should pull work items and then push changes', async () => {
            const mockWorkItems = [{
                id: 123,
                fields: {
                    'System.Title': 'Test Work Item',
                    'System.WorkItemType': 'Task',
                    'System.State': 'New',
                    'System.Description': 'Original description',
                    'System.CreatedDate': '2024-01-01T00:00:00.000Z',
                    'System.ChangedDate': '2024-01-01T00:00:00.000Z',
                    'System.AssignedTo': { displayName: 'John Doe' }
                }
            }];

            // Mock pull operation
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { workItems: [{ id: 123 }] }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    json: { value: mockWorkItems }
                });

            jest.spyOn(api, 'getWorkItems').mockResolvedValue(mockWorkItems);
            (mockApp.vault.adapter.exists as jest.Mock).mockResolvedValue(false);

            // Pull work items
            await workItemManager.pullWorkItems();

            expect(mockApp.vault.createFolder).toHaveBeenCalledWith('Azure DevOps Work Items');
            expect(mockApp.vault.create).toHaveBeenCalledWith(
                'Azure DevOps Work Items/WI-123 Test Work Item.md',
                expect.stringContaining('# Test Work Item')
            );

            // Simulate file modification and push
            const modifiedContent = `---
id: 123
title: "Modified Title"
state: In Progress
---

# Modified Title

## Description

Modified description content
`;

            (mockApp.vault.read as jest.Mock).mockResolvedValue(modifiedContent);
            (mockApp.metadataCache.getFileCache as jest.Mock).mockReturnValue({
                frontmatter: {
                    id: 123,
                    title: 'Modified Title',
                    state: 'In Progress'
                }
            });

            // Mock successful update
            mockRequestUrl.mockResolvedValue({
                status: 200,
                json: {}
            });

            const mockFile = { path: 'WI-123 Test Work Item.md' };
            const pushResult = await workItemManager.pushSpecificWorkItem(mockFile as any);

            expect(pushResult).toBe(true);
            expect(mockRequestUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'PATCH'
                })
            );
        });
    });

    describe('Error Handling Integration', () => {
        it('should handle network failures gracefully', async () => {
            mockRequestUrl.mockRejectedValue(new Error('Network error'));

            const workItemData = {
                title: 'Test Item',
                workItemType: 'Task'
            };

            const result = await api.createWorkItem(workItemData);
            expect(result).toBeNull();
        });

        it('should handle invalid authentication', async () => {
            mockRequestUrl.mockResolvedValue({
                status: 401,
                text: 'Unauthorized'
            });

            const workItemData = {
                title: 'Test Item',
                workItemType: 'Task'
            };

            const result = await api.createWorkItem(workItemData);
            expect(result).toBeNull();
        });

        it('should handle malformed work item data', async () => {
            const validation = api.validateWorkItemData({
                title: '',
                workItemType: ''
            });

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Title is required');
            expect(validation.errors).toContain('Work item type is required');
        });
    });

    describe('Relationship Management Integration', () => {
        it('should handle parent-child relationships', async () => {
            // Mock getting work item without existing relations
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { id: 123, relations: [] }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {}
                });

            const result = await api.addParentChildRelationship(123, 456);
            expect(result).toBe(true);

            expect(mockRequestUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'PATCH',
                    body: expect.stringContaining('System.LinkTypes.Hierarchy-Reverse')
                })
            );
        });

        it('should remove existing parent relationships before adding new ones', async () => {
            const existingRelations = [{
                rel: 'System.LinkTypes.Hierarchy-Reverse',
                url: 'https://dev.azure.com/test-org/_apis/wit/workItems/789'
            }];

            // Mock getting work item with existing relations, then successful removal and addition
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { id: 123, relations: existingRelations }
                })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {}
                })
                .mockResolvedValueOnce({
                    status: 200,
                    json: {}
                });

            const result = await api.addParentChildRelationship(123, 456);
            expect(result).toBe(true);

            // Should have been called 3 times: get existing, remove old, add new
            expect(mockRequestUrl).toHaveBeenCalledTimes(3);
        });
    });

    describe('Settings Update Integration', () => {
        it('should update settings across all components', () => {
            const newSettings = {
                ...settings,
                organization: 'new-org',
                useMarkdownInAzureDevOps: true
            };

            api.updateSettings(newSettings);
            workItemManager.updateSettings(newSettings);

            expect(api.settings).toBe(newSettings);
            expect(workItemManager.settings).toBe(newSettings);
            expect(api.settings.useMarkdownInAzureDevOps).toBe(true);
        });
    });

    describe('Large Dataset Handling', () => {
        it('should handle large numbers of work items efficiently', async () => {
            const largeWorkItemSet = Array.from({ length: 250 }, (_, i) => ({
                id: i + 1,
                fields: {
                    'System.Title': `Work Item ${i + 1}`,
                    'System.WorkItemType': 'Task',
                    'System.State': 'New',
                    'System.CreatedDate': '2024-01-01T00:00:00.000Z',
                    'System.ChangedDate': '2024-01-01T00:00:00.000Z'
                }
            }));

            // Mock the WIQL query response
            const workItemIds = largeWorkItemSet.map(wi => ({ id: wi.id }));
            mockRequestUrl
                .mockResolvedValueOnce({
                    status: 200,
                    json: { workItems: workItemIds }
                });

            // Mock the batch fetch responses (3 batches of 100 items each)
            for (let i = 0; i < 3; i++) {
                const batchStart = i * 100;
                const batchEnd = Math.min(batchStart + 100, 250);
                const batchItems = largeWorkItemSet.slice(batchStart, batchEnd);
                
                mockRequestUrl.mockResolvedValueOnce({
                    status: 200,
                    json: { value: batchItems }
                });
            }

            const result = await api.getWorkItems();
            
            expect(result).toHaveLength(250);
            expect(result[0].id).toBe(1);
            expect(result[249].id).toBe(250);
            
            // Should have made 4 requests: 1 for WIQL query + 3 for batched details
            expect(mockRequestUrl).toHaveBeenCalledTimes(4);
        });
    });

    describe('Content Conversion Integration', () => {
        it('should maintain data integrity through HTML/Markdown conversions', async () => {
            const originalMarkdown = `**Bold text** and *italic text*

| Column 1 | Column 2 |
|----------|----------|
| Cell 1   | Cell 2   |

- List item 1
- List item 2

\`inline code\` and code blocks:

\`\`\`javascript
console.log('hello');
\`\`\`
`;

            // Convert to HTML and back
            const html = await (workItemManager as any).markdownToHtml(originalMarkdown);
            const backToMarkdown = (workItemManager as any).htmlToMarkdown(html);

            // Check that key content is preserved
            expect(backToMarkdown).toContain('Column 1');
            expect(backToMarkdown).toContain('List item 1');
            expect(backToMarkdown).toContain('code');
        });
    });
});