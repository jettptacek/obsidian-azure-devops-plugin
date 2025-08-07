# Agent Guidelines for Obsidian Azure DevOps Plugin

## Build/Test Commands
- `npm run dev` - Development build with watch mode
- `npm run build` - Production build with TypeScript type checking
- `npm run version` - Bump version and update manifest files
- No test framework configured - manual testing required

## Code Style Guidelines

### TypeScript Configuration
- Target ES6, module ESNext, strict null checks enabled
- Use `noImplicitAny: true` for type safety
- Include inline source maps for debugging

### Imports & Dependencies
- Use named imports from 'obsidian' (Plugin, Notice, WorkspaceLeaf, TFile)
- Import local modules with relative paths (./settings, ./api, etc.)
- External dependencies: marked, turndown, turndown-plugin-gfm

### Naming Conventions
- Classes: PascalCase (AzureDevOpsPlugin, WorkItemManager)
- Interfaces: PascalCase with descriptive names (AzureDevOpsSettings, WorkItem)
- Variables/methods: camelCase
- Constants: UPPER_SNAKE_CASE (DEFAULT_SETTINGS, VIEW_TYPE_AZURE_DEVOPS_TREE)

### Error Handling
- Use Obsidian Notice for user-facing errors with emoji prefixes (❌, ✅)
- Validate settings before API calls with early returns
- Handle async operations with proper try/catch blocks