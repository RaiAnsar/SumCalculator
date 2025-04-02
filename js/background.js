class BackgroundManager {
    constructor() {
        // Store visibility state per tabId
        this.tabUiState = new Map(); // Map<tabId, { isVisible: boolean }>
        this.init();
    }

    init() {
        // Use arrow functions for listeners to preserve 'this' context
        chrome.action.onClicked.addListener((tab) => this.handleIconClick(tab));
        chrome.commands.onCommand.addListener((command, tab) => this.handleCommand(command, tab));
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
             if (changeInfo.status === 'loading') {
                // 'this' should now correctly refer to BackgroundManager instance
                this.setUiState(tabId, false);
                this.updateIconState(tabId);
             }
        });
        chrome.tabs.onActivated.addListener(activeInfo => {
            // 'this' should now correctly refer to BackgroundManager instance
            this.updateIconState(activeInfo.tabId);
        });
        chrome.tabs.onRemoved.addListener((tabId) => {
            // 'this' should now correctly refer to BackgroundManager instance
            this.tabUiState.delete(tabId);
        });
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.name === 'ui_closed_by_user') {
                if (sender.tab) {
                    // 'this' should now correctly refer to BackgroundManager instance
                    console.log(`UI closed by user in tab ${sender.tab.id}`);
                    this.setUiState(sender.tab.id, false);
                    this.updateIconState(sender.tab.id);
                }
            }
            // return true; // Only needed if using sendResponse asynchronously
        });

        this.initializeIconStates();
    }

    async initializeIconStates() {
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => this.updateIconState(tab.id));
    }

    async updateIconState(tabId) {
        if (!tabId) return;
        const state = this.getUiState(tabId);
        const iconPaths = this.getIconPaths(state.isVisible);
        try {
            await chrome.action.setIcon({ tabId, path: iconPaths });
        } catch (error) {
            // Ignore errors if the tab no longer exists or we lack permission
            if (!error.message.includes('No tab with id') && !error.message.includes('Cannot access contents')){
                 console.warn(`Error setting icon for tab ${tabId}:`, error.message);
            }
        }
    }

    getIconPaths(isActive) {
        const prefix = isActive ? 'icon' : 'icon_grey';
        return {
            16: `icons/${prefix}16.png`,
            32: `icons/${prefix}32.png`,
            48: `icons/${prefix}48.png`,
            128: `icons/${prefix}128.png`
        };
    }

    async handleIconClick(tab) {
        if (!tab || !tab.id) return;

        // Prevent running on chrome://, about:, or file:// URLs
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('file://'))) {
            console.log("Calculator cannot run on this page.");
            return;
        }

        const currentState = this.getUiState(tab.id);
        const newStateVisible = !currentState.isVisible;
        const messageName = newStateVisible ? 'show_ui' : 'hide_ui';

        try {
            // Ensure content script is ready
            await this.ensureContentScript(tab.id);

            // Send the message to toggle UI
            await chrome.tabs.sendMessage(tab.id, { name: messageName });

            // Update state and icon AFTER successful message send
            this.setUiState(tab.id, newStateVisible);
            this.updateIconState(tab.id);
            console.log(`Sent ${messageName} to tab ${tab.id}`);

        } catch (error) {
            console.error(`Error sending ${messageName} to tab ${tab.id}:`, error);
            // If sending failed, maybe reset the assumed state? 
            // Or just log the error. For now, logging.
        }
    }

    async ensureContentScript(tabId) {
        try {
            // Try pinging first with a short timeout
            await Promise.race([
                chrome.tabs.sendMessage(tabId, { name: 'ping' }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 200))
            ]);
            // Ping successful, script is ready
            return true; 
        } catch (pingError) {
            // Ping failed, inject script
            console.log(`Ping failed for tab ${tabId}, injecting script...`);
            try {
                 await this.injectContentScript(tabId);
                 // Add a small delay to allow script to initialize
                 await new Promise(resolve => setTimeout(resolve, 150)); 
                 return true; // Script injected
            } catch (injectionError) {
                 console.error(`Failed to inject content script into tab ${tabId}:`, injectionError);
                 throw injectionError; // Re-throw injection error
            }
        }
    }

    async handleCommand(command, tab) {
        // Handle commands like opening settings in the future
    }

    async injectContentScript(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['js/content.js']
            });
        } catch (error) {
            if (!error.message.includes('Cannot access contents') && !error.message.includes('Missing host permission') && !error.message.includes('No tab with id')) {
                console.error(`Error injecting content script into tab ${tabId}:`, error);
            }
            // Re-throw error so ensureContentScript knows injection failed
            throw error; 
        }
    }

    getUiState(tabId) {
        return this.tabUiState.get(tabId) || { isVisible: false };
    }

    setUiState(tabId, isVisible) {
        this.tabUiState.set(tabId, { isVisible });
    }
}

// Initialize background manager
new BackgroundManager(); 