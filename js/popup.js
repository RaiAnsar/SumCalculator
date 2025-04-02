class PopupManager {
    constructor() {
        this.settings = {
            position: 'top-right',
            format: 'plain',
            theme: 'light'
        };
        this.stats = {
            totalCalculations: 0,
            avgTime: 0,
            savedTime: 0,
            // Add more detailed stats if needed
            totalTime: 0,
            count: 0
        };
        this.recentCalculations = [];
        this.init();
    }

    async init() {
        // Load settings, stats, and recent calculations
        await this.loadData();

        // Initialize UI elements
        this.initializeUI();

        // Add event listeners
        this.addEventListeners();

        // Update UI with loaded data
        this.updateUI();
    }

    async loadData() {
        const result = await chrome.storage.sync.get(['calculatorSettings', 'calculatorStats', 'recentCalculations']);

        if (result.calculatorSettings) {
            const { mode, ...loadedSettings } = result.calculatorSettings;
            this.settings = { ...this.settings, ...loadedSettings };
        }

        if (result.calculatorStats) {
            this.stats = { ...this.stats, ...result.calculatorStats };
            // Ensure avgTime is calculated correctly if not stored
            if (this.stats.count > 0 && !this.stats.avgTime) {
                this.stats.avgTime = this.stats.totalTime / this.stats.count;
            }
        }

        if (result.recentCalculations) {
            this.recentCalculations = result.recentCalculations;
        }
    }

    initializeUI() {
        // Get DOM elements
        this.elements = {
            themeToggle: document.getElementById('themeToggle'),
            displayPosition: document.getElementById('displayPosition'),
            numberFormat: document.getElementById('numberFormat'),
            totalCalculations: document.getElementById('totalCalculations'),
            avgTime: document.getElementById('avgTime'),
            savedTime: document.getElementById('savedTime'),
            recentCalculationsList: document.getElementById('recentCalculations'),
            helpLink: document.getElementById('helpLink'),
            feedbackLink: document.getElementById('feedbackLink')
        };

        // Set initial theme
        document.body.setAttribute('data-theme', this.settings.theme);
        this.elements.themeToggle.querySelector('.theme-icon').textContent =
            this.settings.theme === 'dark' ? '☀️' : '🌙';
    }

    addEventListeners() {
        // Theme toggle
        this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());

        // Settings changes
        this.elements.displayPosition.addEventListener('change', (e) => this.updateSetting('position', e.target.value));
        this.elements.numberFormat.addEventListener('change', (e) => this.updateSetting('format', e.target.value));

        // Links
        this.elements.helpLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.openHelp();
        });

        this.elements.feedbackLink.addEventListener('click', (e) => {
            e.preventDefault();
            this.openFeedback();
        });
    }

    updateUI() {
        // Update settings UI
        this.elements.displayPosition.value = this.settings.position;
        this.elements.numberFormat.value = this.settings.format;

        // Update stats UI
        this.elements.totalCalculations.textContent = (this.stats.totalCalculations || 0).toLocaleString();
        this.elements.avgTime.textContent = `${(this.stats.avgTime || 0).toFixed(1)}ms`;
        this.elements.savedTime.textContent = `${((this.stats.savedTime || 0) / 3600).toFixed(1)}h`;

        // Update recent calculations list
        this.updateRecentCalculationsList();
    }

    updateRecentCalculationsList() {
        this.elements.recentCalculationsList.innerHTML = ''; // Clear existing list

        if (this.recentCalculations.length === 0) {
            this.elements.recentCalculationsList.innerHTML = '<p class="no-recent">No recent calculations.</p>';
            return;
        }

        const list = document.createElement('ul');
        this.recentCalculations.forEach(calc => {
            const item = document.createElement('li');
            
            // Display detailed information with counts breakdown if available
            let detailText = '';
            
            if (calc.count) {
                detailText = ' (';
                
                // Add count info
                if (calc.count > 0) {
                    const counts = [];
                    
                    // Only add positive count if it exists
                    if (calc.positiveCount > 0) {
                        counts.push(`<span class="positive-item">+${calc.positiveCount}</span>`);
                    }
                    
                    // Only add zero count if it exists
                    if (calc.zeroCount > 0) {
                        counts.push(`<span class="zero-item">0:${calc.zeroCount}</span>`);
                    }
                    
                    // Only add negative count if it exists
                    if (calc.negativeCount > 0) {
                        counts.push(`<span class="negative-item">-${calc.negativeCount}</span>`);
                    }
                    
                    detailText += counts.join(' | ');
                }
                
                detailText += ')';
            }
            
            // Use result if available, otherwise simple summary
            const resultText = calc.result || `Sum: ${calc.sum || 0}, Count: ${calc.count || 0}`;
            
            item.innerHTML = `${resultText}${detailText}`;
            item.title = new Date(calc.timestamp).toLocaleString();
            list.appendChild(item);
        });
        this.elements.recentCalculationsList.appendChild(list);
    }

    async updateSetting(key, value) {
        this.settings[key] = value;
        // Ensure mode is not saved
        const { mode, ...settingsToSave } = this.settings;
        await chrome.storage.sync.set({ calculatorSettings: settingsToSave });

        // Notify content script if needed (format, position, theme)
        if ([/*'mode',*/ 'format', 'position', 'theme'].includes(key)) { // Mode removed
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        name: 'update_settings',
                        settings: { [key]: value }
                    });
                } catch (error) {
                    console.warn("Could not send settings update to content script:", error.message);
                }
            }
        }
    }

    async toggleTheme() {
        this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
        document.body.setAttribute('data-theme', this.settings.theme);
        this.elements.themeToggle.querySelector('.theme-icon').textContent =
            this.settings.theme === 'dark' ? '☀️' : '🌙';

        await chrome.storage.sync.set({ calculatorSettings: this.settings });
    }

    openHelp() {
        // Replace with your actual help/wiki URL
        chrome.tabs.create({
            url: 'https://github.com/yourusername/sum-calculator-pro/wiki'
        });
    }

    openFeedback() {
        // Replace with your actual feedback/issues URL
        chrome.tabs.create({
            url: 'https://github.com/yourusername/sum-calculator-pro/issues'
        });
    }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
}); 