<div align="center">
	<h1>Azure DevOps Backlog</h1>
	<b>An <a href="https://obsidian.md/" target="_blank">Obsidian</a> plugin for Azure DevOp Work Item management.</b>
</div>
<br>

![gif](./demos/PullPushDemo.gif)

## ⚡ Key Features
-  Azure DevOps Work Items Syncization 
  	- Pull work items from Azure DevOps into Obsidian notes (`html -> markdown`)
	- Push changes from Obsidian back to Azure DevOps (`markdown -> html`)
- Interactive Tree View
  	- Quick access to work item details and Azure DevOps links
	- Visual hierarchy of work items with drag-and-drop reordering
	- Real-time change indicators for modified items
	- Expand/collapse functionality for better navigation
- Validate Azure DevOps links in descriptions
	- Automatically update outdated work item references

## ⚙️ Settings
- Azure DevOps Organization and Project
- Personal Access Token - Requires read and write permissions (`https://dev.azure.com/{Organization}/_usersSettings/tokens`)
- Use Markdown in Auzre DevOps (!!! Not fully avaiable in Azure DevOps as of 7/25/2025)

## 📥 Installation
- Obsidian Community Plugins: https://obsidian.md/plugins?id=azure-devops-plugin
- Manually: go to the [latest release](https://github.com/jettptacek/azure-devops-plugin/releases/latest) → copy `main.js`, `manifest.json`, `styles.css` to `your-vault/.obsidian/plugins/azure-devops-plugin/`

## TODO
- [ ] Table Column Alignment
- [ ] Tree View Filter and Search

## Libraries Used
- https://github.com/markedjs/marked
- https://github.com/mixmark-io/turndown

## Support
[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/jettptacek)

<div align="center">
  <b>MIT licensed | © 2025 <a href="https://github.com/jettptacek">Jett Ptacek</a></b>
</div>
