# Azure DevOps Plugin Data Flow

This document outlines how the Obsidian Azure DevOps plugin retrieves and sends data to Azure DevOps.

## Pull Operations (Getting Data)

### 1. Pull All Work Items (`pullWorkItems`)

**Endpoint Called:** 
- WIQL Query: `https://dev.azure.com/{organization}/{project}/_apis/wit/wiql?api-version=7.0`
- Work Item Details: `https://dev.azure.com/{organization}/{project}/_apis/wit/workitems?ids={ids}&$expand=all&api-version=7.0`

**Data Received:**
- WIQL query returns work item IDs matching the criteria
- Batch requests (100 items per batch) retrieve full work item details
- Each work item contains: fields, relations, links, metadata

**Local Data Changes:**
- Creates/updates markdown files in `Azure DevOps Work Items/` folder
- File naming: `WI-{id} {sanitized-title}.md`
- Sets baseline content for change tracking
- Clears change indicators in tree view
- Updates tree view display

### 2. Pull Specific Work Item (`pullSpecificWorkItem`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/{id}?$expand=all&api-version=7.0`

**Data Received:**
- Complete work item data including fields, relations, and metadata

**Local Data Changes:**
- Updates the specific markdown file with latest data
- Refreshes tree view display
- Resets change tracking for that item

### 3. Get Work Item Types (`getWorkItemTypes`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/workitemtypes?api-version=7.0`

**Data Received:**
- List of available work item types (Bug, Task, User Story, etc.)
- Filters out disabled and system types

**Local Data Changes:**
- Used to populate creation modals and validation

### 4. Get Work Item Fields (`getWorkItemFields`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/fields?api-version=7.0`

**Data Received:**
- Complete list of all available fields for the project
- Includes custom fields and their types

**Local Data Changes:**
- Used for custom field validation and processing

## Push Operations (Sending Data)

### 1. Create Work Item (`createWorkItem`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/$${workItemType}?api-version=7.0`

**Data Sent:**
```json
[
  {
    "op": "add",
    "path": "/fields/System.Title",
    "value": "Work item title"
  },
  {
    "op": "add", 
    "path": "/fields/System.Description",
    "value": "Work item description"
  }
]
```

**Local Data Changes:**
- Creates new markdown file for the work item
- Updates tree view to show new item
- Sets baseline content for change tracking

### 2. Update Work Item (`updateWorkItem`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/{id}?api-version=7.0`

**Data Sent:**
```json
[
  {
    "op": "replace",
    "path": "/fields/System.Title", 
    "value": "Updated title"
  },
  {
    "op": "replace",
    "path": "/fields/System.Description",
    "value": "Updated description"
  }
]
```

**Local Data Changes:**
- Updates push timestamp in markdown file
- Clears change tracking indicators
- Refreshes tree view display

### 3. Add Parent-Child Relationship (`addParentChildRelationship`)

**Endpoint Called:**
`https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/{childId}?api-version=7.0`

**Data Sent:**
```json
[
  {
    "op": "add",
    "path": "/relations/-",
    "value": {
      "rel": "System.LinkTypes.Hierarchy-Reverse",
      "url": "https://dev.azure.com/{organization}/_apis/wit/workItems/{parentId}",
      "attributes": {
        "comment": "Parent relationship added from Obsidian"
      }
    }
  }
]
```

**Local Data Changes:**
- Updates relationship tracking
- Refreshes tree view to show hierarchy changes

## Data Processing

### HTML ↔ Markdown Conversion

**Pull (HTML → Markdown):**
- Uses TurndownService to convert Azure DevOps HTML descriptions to Markdown
- Preserves tables, lists, formatting, and links
- Special handling for Azure DevOps-specific HTML structures

**Push (Markdown → HTML):**
- Uses marked library to convert Markdown back to HTML
- Custom table processing for proper Azure DevOps compatibility
- Handles inline formatting, code blocks, and links

### Change Detection

**Local Change Tracking:**
- Compares current note content with baseline content from last pull
- Tracks frontmatter changes (title, state, assignedTo, etc.)
- Tracks description changes in markdown content
- Tracks custom field modifications

**Tree View Indicators:**
- Modified items show with visual indicators
- Pending changes counter in tree view
- Push button availability based on changes

### Authentication

All API calls use Basic authentication:
```
Authorization: Basic {base64(':' + personalAccessToken)}
```

### Error Handling

- Validates settings before API calls
- Handles network failures gracefully
- Shows user-friendly error messages via Obsidian Notice
- Logs detailed errors to console for debugging

## Data Flow Summary

```
Pull: Azure DevOps API → JSON Response → Markdown Files → Tree View Update
Push: Markdown Files → Change Detection → JSON Patch → Azure DevOps API → Local Update
```

The plugin maintains a bidirectional sync between Azure DevOps work items and local Markdown files, with robust change tracking and conflict prevention mechanisms.