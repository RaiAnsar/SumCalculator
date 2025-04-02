# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands
- **Load Extension**: Open Chrome, go to `chrome://extensions/`, enable "Developer mode", click "Load unpacked", select SumCalculator folder
- **Test Extension**: After loading, test in browser by clicking the extension icon
- **Data Inspection**: Use Chrome DevTools storage inspector to view extension storage

## Code Style Guidelines
- **JavaScript**: ES6+ syntax, classes for components
- **Naming**: camelCase for variables/methods, PascalCase for classes
- **Indentation**: 4 spaces
- **Formatting**: Single quotes for strings, semicolons required
- **DOM Handling**: Use classList methods for toggling classes
- **Event Listeners**: Use arrow functions to preserve 'this' context
- **Error Handling**: Try/catch around Chrome API calls with informative error messages
- **Architecture**: Background, Content, and Popup scripts follow separation of concerns
- **CSS**: Component-scoped classes to avoid conflicts with page styles
- **Performance**: Use rAF for UI updates, debounce scroll/resize events