class SumCalculator {
    constructor() {
        this.overlay = null;
        this.isVisible = false; // Track UI visibility state
        this.currentPosition = { top: null, left: null, bottom: null, right: null }; // Store current corner position

        this.settings = {
            position: 'top-right', // Default corner
            format: 'plain',
            theme: 'light'
        };
        // Store last calculated values
        this.lastResult = { sum: 0, average: 0, min: 0, max: 0, count: 0, positiveCount: 0, negativeCount: 0 };

        // Enhanced cell selection tracking
        this.isSelectingCells = false;
        this.selectedCells = new Set();
        this.highlightedElements = new Set();
        this.lastVisitedCell = null;
        this.lastPosition = { x: 0, y: 0 };
        this.selectionOrigin = { x: 0, y: 0 };
        this.initialCell = null;
        
        // Performance optimization
        this.pendingRaf = null;
        this.lastProcessTime = 0;
        this.processingThreshold = 30; // ms between processing
        this.cellCache = new Map(); // Cache for cell detection results

        this.init();
    }

    init() {
        // Load settings from storage
        chrome.storage.sync.get(['calculatorSettings'], (result) => {
            if (result.calculatorSettings) {
                const { mode, ...loadedSettings } = result.calculatorSettings;
                this.settings = { ...this.settings, ...loadedSettings };
            }
            // Apply initial position based on settings AFTER loading them
            this.applyCornerPosition(this.settings.position);
        });

        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.name === 'ping') {
                sendResponse(true);
            } else if (message.name === 'show_ui') {
                this.showOverlay();
            } else if (message.name === 'hide_ui') {
                this.hideOverlay();
            } else if (message.name === 'update_settings') {
                const oldPositionSetting = this.settings.position;
                const { mode, ...otherSettings } = message.settings;
                this.settings = { ...this.settings, ...otherSettings };
                if (this.settings.position && this.settings.position !== oldPositionSetting) {
                    this.applyCornerPosition(this.settings.position);
                }
                if (this.overlay && this.settings.theme) {
                    this.overlay.classList.toggle('dark', this.settings.theme === 'dark');
                }
            }
        });

        // Use passive event listeners where possible for better performance
        document.addEventListener('mousedown', this.handleMouseDown.bind(this), { passive: false, capture: true });
        document.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: true, capture: true });
        document.addEventListener('mouseup', this.handleMouseUp.bind(this), { passive: true, capture: true });
        window.addEventListener('scroll', this.handleScroll.bind(this), { passive: true, capture: true });
    }

    createOverlay() {
        if (this.overlay) return; // Already exists

        this.overlay = document.createElement('div');
        this.overlay.className = 'sum-calculator-overlay';
        this.overlay.classList.toggle('dark', this.settings.theme === 'dark');
        this.overlay.style.position = 'fixed';
        this.overlay.style.display = 'none'; // Start hidden

        // Enhanced HTML structure with improved layout
        this.overlay.innerHTML = `
            <div class="calculator-header">
                <h3 class="calculator-title">Calculation</h3>
                <button class="calculator-close">×</button>
            </div>
            <div class="calculator-content metrics-grid">
                <div class="metric-item"><span class="metric-label">SUM</span><span class="metric-value" id="sum-value">0</span></div>
                <div class="metric-item"><span class="metric-label">AVERAGE</span><span class="metric-value" id="avg-value">0</span></div>
                <div class="metric-item"><span class="metric-label">MIN</span><span class="metric-value" id="min-value">0</span></div>
                <div class="metric-item"><span class="metric-label">MAX</span><span class="metric-value" id="max-value">0</span></div>
                
                <!-- Improved Count Row with Zero in the middle -->
                <div class="metric-item metric-item-counts">
                    <span class="metric-label">COUNT</span>
                    <span class="metric-value metric-counts-composite" id="counts-value">
                        <span id="total-count">0</span>
                        <span class="count-breakdown">
                            <span class="positive-count"><span class="count-icon">+</span><span id="pos-count">0</span></span>
                            <span class="count-separator">|</span>
                            <span class="zero-count"><span class="count-icon">0</span><span id="zero-count">0</span></span>
                            <span class="count-separator">|</span>
                            <span class="negative-count"><span class="count-icon">-</span><span id="neg-count">0</span></span>
                        </span>
                    </span>
                </div>
            </div>
            <div class="calculator-actions">
                <button class="feedback-button" title="Report bugs or request features"><span class="feedback-icon">⚡</span></button>
                <button class="calculator-button secondary" data-action="copy-all">Copy All</button>
            </div>
        `;

        this.overlay.querySelector('.calculator-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideOverlay();
            // Notify background to update state (handle potential context invalidation)
            try {
                chrome.runtime.sendMessage({ name: 'ui_closed_by_user' });
            } catch (error) {
                console.warn("[SumCalc] Failed to notify background about UI close (context likely invalidated):", error.message);
            }
        });
        
        // Add feedback button listener
        this.overlay.querySelector('.feedback-button').addEventListener('click', (e) => {
            e.stopPropagation();
            // Open GitHub issues page in a new tab
            window.open('https://github.com/yourusername/SumCalculator/issues/new', '_blank');
        });
        
        // Updated Copy button listener
        this.overlay.querySelector('[data-action="copy-all"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyAllResult(); 
        });

        document.body.appendChild(this.overlay);
        this.applyCurrentPosition();
    }

    applyCornerPosition(positionSetting) {
        const padding = 20;
        const positions = {
            'top-right': { top: padding + 'px', right: padding + 'px', bottom: null, left: null },
            'top-left': { top: padding + 'px', left: padding + 'px', bottom: null, right: null },
            'bottom-right': { bottom: padding + 'px', right: padding + 'px', top: null, left: null },
            'bottom-left': { bottom: padding + 'px', left: padding + 'px', top: null, right: null }
        };
        // Store the target corner position
        this.currentPosition = positions[positionSetting] || positions['top-right'];
        // Apply the position immediately if overlay exists
        if (this.overlay) {
            this.applyCurrentPosition();
        }
    }

    applyCurrentPosition() {
        if (!this.overlay) return;
        // Reset all first
        this.overlay.style.top = '';
        this.overlay.style.bottom = '';
        this.overlay.style.left = '';
        this.overlay.style.right = '';
        // Apply stored corner position
        for (const prop in this.currentPosition) {
            if (this.currentPosition[prop] !== null) {
                this.overlay.style[prop] = this.currentPosition[prop];
            }
        }
    }

    handleMouseDown(event) {
        if (!this.isVisible || event.button !== 0 || event.target.closest('.sum-calculator-overlay')) return;

        const targetCell = this.findTargetCell(event.target);
        if (targetCell && this.cellHasNumber(targetCell)) {
            event.preventDefault();
            event.stopPropagation();
            
            this.isSelectingCells = true;
            this.clearSelection();
            
            // Store both viewport and document coordinates for better tracking
            this._initialScrollY = window.scrollY;
            this._lastScrollY = window.scrollY;
            
            // Store viewport (client) coordinates
            this.selectionOrigin = { 
                x: event.clientX, 
                y: event.clientY,
                // Also store absolute document position to handle scroll properly
                pageX: event.pageX,
                pageY: event.pageY
            };
            
            // Store cell position for better recovery during scroll
            const cellRect = targetCell.getBoundingClientRect();
            this.selectionOrigin.cellX = cellRect.left + (cellRect.width / 2);
            this.selectionOrigin.cellY = cellRect.top + (cellRect.height / 2);
            
            // Initialize tracking state
            this.lastPosition = { 
                x: event.clientX, 
                y: event.clientY,
                pageX: event.pageX,
                pageY: event.pageY
            };
            
            this.initialCell = targetCell;
            this.initialCellValue = this.extractNumberFromCell(targetCell);
            this.lastVisitedCell = targetCell;
            this._lastDirection = null;
            
            // Add first cell and ensure it stays selected
            this.addCellToSelection(targetCell, true); // Force add with true
            targetCell._isOriginCell = true; // Mark as origin cell
            this.processSelectedCells();
            
            document.body.style.userSelect = 'none';
        } else {
            this.isSelectingCells = false;
        }
    }

    handleMouseMove(event) {
        if (!this.isSelectingCells || !this.isVisible) { return; }
        
        // Cancel any pending animation frame
        if (this.pendingRaf) {
            cancelAnimationFrame(this.pendingRaf);
        }
        
        // Process mouse move in the next animation frame
        this.pendingRaf = requestAnimationFrame(() => {
            // Only process if enough time has passed since last update
            const now = performance.now();
            if (now - this.lastProcessTime < this.processingThreshold) return;
            
            // Performance: skip processing if barely moved
            const dx = event.clientX - this.lastPosition.x;
            const dy = event.clientY - this.lastPosition.y;
            const distance = Math.sqrt(dx*dx + dy*dy);
            if (distance < 3) return; // Skip tiny movements
            
            // Process cells along the path
            this.processMousePath({x: event.clientX, y: event.clientY});
            
            // Update last position only after processing
            this.lastPosition = { 
                x: event.clientX, 
                y: event.clientY,
                pageX: event.pageX,
                pageY: event.pageY
            };
            this.lastProcessTime = now;
        });
    }
    
    // Enhanced backtracking detection with scroll compensation
    isMovingBackwards(currentPos) {
        // Get current scroll-adjusted origin position
        const scrollOffset = window.scrollY - (this._initialScrollY || 0);
        const adjustedOriginY = this.selectionOrigin.y - scrollOffset;
        
        // Use adjusted origin for vector calculations
        const originToCurrent = {
            x: currentPos.x - this.selectionOrigin.x,
            y: currentPos.y - adjustedOriginY
        };
        
        const originToLast = {
            x: this.lastPosition.x - this.selectionOrigin.x,
            y: this.lastPosition.y - adjustedOriginY
        };
        
        // Calculate magnitudes (distances from origin)
        const currentMagnitude = Math.sqrt(
            originToCurrent.x * originToCurrent.x + 
            originToCurrent.y * originToCurrent.y
        );
        
        const lastMagnitude = Math.sqrt(
            originToLast.x * originToLast.x + 
            originToLast.y * originToLast.y
        );
        
        // Calculate movement vector (direction we're moving)
        const movement = {
            x: currentPos.x - this.lastPosition.x,
            y: currentPos.y - this.lastPosition.y
        };
        
        // Get normalized vector from origin to current position
        let normalizedOriginToCurrent = { x: 0, y: 0 };
        if (currentMagnitude > 0) {
            normalizedOriginToCurrent = {
                x: originToCurrent.x / currentMagnitude,
                y: originToCurrent.y / currentMagnitude
            };
        }
        
        // Calculate dot product to determine if movement aligns with direction from origin
        const dotProduct = (movement.x * normalizedOriginToCurrent.x) + 
                           (movement.y * normalizedOriginToCurrent.y);
        
        // Handle special case for initial movements
        if (currentMagnitude < 10) {
            return false; // Don't consider it backward when very close to origin
        }
        
        // If we're moving away from origin but in opposite direction
        // (dot product is negative when vectors point in opposite directions)
        if (currentMagnitude > 5 && dotProduct < -0.5) { // More strict threshold
            return true;
        }
        
        // If we're moving closer to origin and not just minor adjustments
        const magnitudeDifference = lastMagnitude - currentMagnitude;
        return magnitudeDifference > 5; // Only consider it backwards if we move significantly closer
    }

    // Completely redesigned path processing with intelligent selection and deselection
    processMousePath(currentPos) {
        // Store current mouse position for tracking
        const startPos = this.lastPosition;
        
        // Calculate movement distance and direction
        const dx = currentPos.x - startPos.x;
        const dy = currentPos.y - startPos.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        // Skip processing if movement is minimal to avoid jitter
        if (distance < 2) return;
        
        // Check if we're moving backwards (away from our current drag direction)
        const isMovingBack = this.isMovingBackwards(currentPos);
        
        // Store current selection for analysis
        if (!this._lastSelectionSnapshot) {
            this._lastSelectionSnapshot = new Set(this.selectedCells);
        }
        
        // Always make sure the origin cell stays selected - foundation of the selection
        if (this.initialCell && !this.selectedCells.has(this.initialCell) && this.initialCell.isConnected) {
            this.addCellToSelection(this.initialCell, true);
        }
        
        // Create sampling points along the path with high density near cursor
        const points = [];
        const steps = Math.max(6, Math.floor(distance / 2));
        
        // Always include the origin cell area in our samples (highest priority)
        if (this.initialCell && this.initialCell.isConnected) {
            const cellRect = this.initialCell.getBoundingClientRect();
            const centerX = cellRect.left + (cellRect.width / 2);
            const centerY = cellRect.top + (cellRect.height / 2);
            
            // Create a dense grid around the origin cell to ensure it's always captured
            for (let xOff = -8; xOff <= 8; xOff += 4) {
                for (let yOff = -8; yOff <= 8; yOff += 4) {
                    points.push({
                        x: centerX + xOff, 
                        y: centerY + yOff, 
                        priority: 10, // Highest priority for origin cell area
                        near_origin: true
                    });
                }
            }
        }
        
        // Sample points along the movement path (linear interpolation with extra sampling)
        for (let i = 0; i <= steps; i++) {
            const fraction = i / steps;
            const x = startPos.x + (dx * fraction);
            const y = startPos.y + (dy * fraction);
            
            // Create a grid of points around path point for better coverage
            // Denser around the newest position (end of path)
            const coverage = i > steps * 0.8 ? 4 : 3; // More coverage near cursor
            
            for (let xOff = -coverage; xOff <= coverage; xOff += 2) {
                for (let yOff = -coverage; yOff <= coverage; yOff += 2) {
                    points.push({
                        x: x + xOff,
                        y: y + yOff,
                        priority: 5 - Math.min(5, Math.sqrt(xOff*xOff + yOff*yOff)) // Higher priority closer to path
                    });
                }
            }
        }
        
        // Sort points by priority for intelligent processing
        points.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        // Process all points to find cells
        const visitedCells = new Set();
        let addedCount = 0;
        let removedCount = 0;
        
        for (const point of points) {
            // Get elements at this point in the DOM (top-to-bottom)
            const elementsAtPoint = document.elementsFromPoint(point.x, point.y);
            
            // Check a reasonable number of elements (more for high priority points)
            const elements = point.priority > 7 ? elementsAtPoint.slice(0, 8) : 
                             point.priority > 3 ? elementsAtPoint.slice(0, 5) : 
                             elementsAtPoint.slice(0, 3);
                             
            for (const element of elements) {
                // Find the cell containing this element (if any)
                const cell = this.findTargetCell(element);
                
                // Skip if no valid cell or already processed
                if (!cell || visitedCells.has(cell)) continue;
                visitedCells.add(cell);
                
                // Special handling for the origin cell - never remove it
                if (cell === this.initialCell || cell._isOriginCell) {
                    if (!this.selectedCells.has(cell)) {
                        this.addCellToSelection(cell, true);
                        addedCount++;
                    }
                    continue;
                }
                
                // Handle based on direction (deselection vs selection)
                if (isMovingBack) {
                    // When moving backwards (deselecting), we need more controlled behavior
                    
                    // Only deselect cells that weren't in our recent movement path
                    if (this.selectedCells.has(cell) && 
                        !point.near_origin && // Never remove cells near origin
                        this._lastSelectionSnapshot.has(cell)) { // Only deselect cells from previous state
                        
                        // Remove cell from current selection
                        this.removeCellFromSelection(cell);
                        removedCount++;
                    }
                } else {
                    // Normal selection - add cells that have numbers and aren't already selected
                    if (!this.selectedCells.has(cell) && this.cellHasNumber(cell)) {
                        this.addCellToSelection(cell);
                        addedCount++;
                    }
                }
            }
        }
        
        // Update calculations if the selection changed
        if (addedCount > 0 || removedCount > 0) {
            // Fill gaps in the selection for better UX
            if (addedCount > 0 && !isMovingBack && this.selectedCells.size > 2) {
                this.fillGapsInSelection();
            }
            
            // Update the count display
            this.processSelectedCells();
            
            // Update selection snapshot for next movement
            this._lastSelectionSnapshot = new Set(this.selectedCells);
        }
    }

    // Complete redesign of scroll handling for continuous selection
    handleScroll(event) {
        if (!this.isSelectingCells) return;
        
        if (this.pendingRaf) {
            cancelAnimationFrame(this.pendingRaf);
        }
        
        this.pendingRaf = requestAnimationFrame(() => {
            // Track scroll position and movement
            const currentScroll = window.scrollY;
            const isScrollingUp = event?.deltaY ? event.deltaY < 0 : currentScroll < (this._lastScrollY || 0);
            const scrollDelta = Math.abs(currentScroll - (this._lastScrollY || currentScroll));
            this._lastScrollY = currentScroll;
            
            // Too small scroll delta might be a browser bounce - skip processing
            if (scrollDelta < 2) return;
            
            // Total scroll distance from initial point - used for adjusting coordinates
            const totalScrollOffset = currentScroll - this._initialScrollY;
            
            // Store last selected cells to ensure continuous selection
            if (!this._lastSelectedCellsArray) {
                this._lastSelectedCellsArray = Array.from(this.selectedCells);
            }
            
            // Get cells at the selection frontier (the edge in the scroll direction)
            const frontierCells = this.getFrontierCells(isScrollingUp);
            
            // Create points for scanning
            const points = [];
            
            // Always ensure origin cell is checked first
            if (this.initialCell && this.initialCell.isConnected) {
                const rect = this.initialCell.getBoundingClientRect();
                if (rect) {
                    // Dense sampling around the origin cell
                    for (let xOff = -10; xOff <= 10; xOff += 5) {
                        for (let yOff = -10; yOff <= 10; yOff += 5) {
                            points.push({
                                x: rect.left + (rect.width / 2) + xOff,
                                y: rect.top + (rect.height / 2) + yOff,
                                priority: 10 // Highest priority
                            });
                        }
                    }
                }
            }
            
            // Add points around frontier cells to extend selection
            if (frontierCells.length > 0) {
                frontierCells.forEach(cell => {
                    if (!cell || !cell.isConnected) return;
                    
                    try {
                        const rect = cell.getBoundingClientRect();
                        if (!rect) return;
                        
                        const cellWidth = rect.width;
                        const cellHeight = rect.height;
                        const cellCenterX = rect.left + (cellWidth / 2);
                        const cellCenterY = rect.top + (cellHeight / 2);
                        
                        // Add points in the direction of scrolling to extend selection
                        const yDirection = isScrollingUp ? -1 : 1;
                        
                        // Add points around the frontier cell and in the scroll direction
                        for (let i = 1; i <= 3; i++) {
                            // Distance to scan in the scroll direction
                            const scanDistance = i * cellHeight * 1.2;
                            
                            // Add points at increasing distances in scroll direction
                            for (let xOffset = -cellWidth; xOffset <= cellWidth; xOffset += cellWidth/2) {
                                points.push({
                                    x: cellCenterX + xOffset,
                                    y: cellCenterY + (scanDistance * yDirection),
                                    priority: 5 // High priority
                                });
                            }
                        }
                    } catch (err) {
                        console.warn("[SumCalc] Error getting cell geometry:", err);
                    }
                });
            }
            
            // Add scanning grid in the scrolling direction
            const baseX = this.lastPosition.x;
            const baseY = this.lastPosition.y;
            const direction = isScrollingUp ? -1 : 1;
            
            // Adaptive grid based on scroll speed
            const stepSize = Math.max(3, Math.min(10, Math.floor(scrollDelta / 10)));
            // Longer scan distance when scrolling faster
            const scanDistance = Math.max(200, scrollDelta * 2);
            const xRange = 80; // Wide horizontal coverage
            
            // Use a 2D grid pattern with horizontal zigzag for better coverage
            for (let yOffset = 0; yOffset <= scanDistance; yOffset += stepSize) {
                // Create horizontal rows of scan points
                for (let xOffset = -xRange; xOffset <= xRange; xOffset += 8) {
                    // Slight zigzag for better coverage
                    const xAdjust = (yOffset % 20 === 0) ? 5 : 0;
                    
                    // Add regular grid points
                    points.push({
                        x: baseX + xOffset + xAdjust,
                        y: baseY + (yOffset * direction),
                        priority: 1 // Regular priority
                    });
                    
                    // Connect back to previously selected cells - avoid gaps by adding interpolated points
                    this._lastSelectedCellsArray.forEach(prevCell => {
                        if (prevCell && prevCell.isConnected) {
                            try {
                                const rect = prevCell.getBoundingClientRect();
                                const prevCellX = rect.left + (rect.width / 2);
                                const prevCellY = rect.top + (rect.height / 2);
                                
                                // Add connecting points if the scan and previous cell are somewhat aligned
                                const scanX = baseX + xOffset + xAdjust;
                                const scanY = baseY + (yOffset * direction);
                                
                                if (Math.abs(scanX - prevCellX) < 50) {
                                    // Add midpoint to ensure selection continuity
                                    points.push({
                                        x: (scanX + prevCellX) / 2,
                                        y: (scanY + prevCellY) / 2,
                                        priority: 3, // Medium priority
                                        connecting: true
                                    });
                                }
                            } catch (err) {
                                // Ignore errors from potential stale elements
                            }
                        }
                    });
                }
            }
            
            // Sort points by priority 
            points.sort((a, b) => (b.priority || 0) - (a.priority || 0));
            
            // Process points to find cells
            const visitedCells = new Set();
            let changedCount = 0;
            
            // First find all cells from scan points
            for (const point of points) {
                const elementsAtPoint = document.elementsFromPoint(point.x, point.y);
                
                // Check elements at each point, more elements for higher priority points
                const elementCount = point.priority > 5 ? 10 : point.priority > 2 ? 6 : 4;
                for (const element of elementsAtPoint.slice(0, elementCount)) {
                    const cell = this.findTargetCell(element);
                    
                    if (!cell || visitedCells.has(cell)) continue;
                    visitedCells.add(cell);
                    
                    // Add cells with numbers that aren't already selected
                    if (!this.selectedCells.has(cell) && this.cellHasNumber(cell)) {
                        // Add cell to selection
                        this.addCellToSelection(cell);
                        changedCount++;
                    }
                }
            }
            
            // Always ensure the initial cell stays selected
            if (this.initialCell && this.initialCell.isConnected) {
                if (!this.selectedCells.has(this.initialCell)) {
                    this.addCellToSelection(this.initialCell, true);
                    changedCount++;
                }
            }
            
            // Fill in any gaps between selected cells
            if (changedCount > 0 && this.selectedCells.size > 1) {
                this.fillGapsInSelection();
            }
            
            // Update computation if selection changed
            if (changedCount > 0) {
                this.processSelectedCells();
                // Store the updated cell array for next scroll
                this._lastSelectedCellsArray = Array.from(this.selectedCells);
            }
            
            // Update last position for next scroll event
            const positionOffset = Math.min(scrollDelta, 60);
            this.lastPosition = {
                x: baseX,
                y: baseY + (direction * positionOffset),
                pageX: this.lastPosition.pageX,
                pageY: this.lastPosition.pageY + (direction * scrollDelta)
            };
        });
    }
    
    // New helper to get the "frontier" cells - cells at the edge of the selection in scroll direction
    getFrontierCells(isScrollingUp) {
        if (this.selectedCells.size === 0) {
            // If no cells yet, use the initial cell
            return this.initialCell ? [this.initialCell] : [];
        }
        
        // Convert to array for easier processing
        const cellsArray = Array.from(this.selectedCells);
        
        try {
            // Get all cell positions
            const cellPositions = cellsArray.map(cell => {
                if (!cell || !cell.isConnected) return null;
                const rect = cell.getBoundingClientRect();
                return {
                    cell: cell,
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    center: rect.top + (rect.height / 2)
                };
            }).filter(Boolean); // Remove null entries
            
            if (cellPositions.length === 0) return [];
            
            // Sort by position
            cellPositions.sort((a, b) => a.center - b.center);
            
            // Get the 3 cells at the frontier in the scrolling direction
            if (isScrollingUp) {
                // Get the top 3 cells when scrolling up
                return cellPositions.slice(0, 3).map(pos => pos.cell);
            } else {
                // Get the bottom 3 cells when scrolling down
                return cellPositions.slice(-3).map(pos => pos.cell);
            }
        } catch (err) {
            console.warn("[SumCalc] Error finding frontier cells:", err);
            return [];
        }
    }
    
    // New method to intelligently fill gaps in the selection
    fillGapsInSelection() {
        // Get all cells as array to analyze position patterns
        const cellsArray = Array.from(this.selectedCells);
        if (cellsArray.length < 2) return;
        
        // Try both column and row gap filling
        this.fillColumnGaps(cellsArray);
        this.fillRowGaps(cellsArray);
        
        // Add special diagonal gap filling for tables
        this.fillCornerGaps(cellsArray);
    }
    
    // Fill gaps in columns (vertical alignment)
    fillColumnGaps(cellsArray) {
        try {
            // Group cells by approximate X position (column)
            const columnGroups = new Map();
            const columnTolerance = 10; // pixels
            
            // Create column groups
            cellsArray.forEach(cell => {
                if (!cell || !cell.isConnected) return;
                
                const rect = cell.getBoundingClientRect();
                const centerX = rect.left + (rect.width / 2);
                
                // Find a matching column or create a new one
                let foundColumn = false;
                for (const [colX, cells] of columnGroups.entries()) {
                    if (Math.abs(centerX - colX) < columnTolerance) {
                        cells.push({ cell, rect, centerY: rect.top + (rect.height / 2) });
                        foundColumn = true;
                        break;
                    }
                }
                
                if (!foundColumn) {
                    columnGroups.set(centerX, [{ cell, rect, centerY: rect.top + (rect.height / 2) }]);
                }
            });
            
            // Process each column to fill gaps
            for (const [colX, cells] of columnGroups.entries()) {
                if (cells.length < 2) continue; // Need at least 2 cells to find gaps
                
                // Sort cells by Y position
                cells.sort((a, b) => a.centerY - b.centerY);
                
                // Look for gaps between consecutive cells
                for (let i = 0; i < cells.length - 1; i++) {
                    const currentCell = cells[i];
                    const nextCell = cells[i + 1];
                    
                    // Calculate gap size
                    const gap = nextCell.centerY - (currentCell.rect.bottom);
                    const avgHeight = (currentCell.rect.height + nextCell.rect.height) / 2;
                    
                    // If gap is significant but not too large
                    if (gap > avgHeight * 0.3 && gap < avgHeight * 4) {
                        // Scan the gap area to find missing cells
                        for (let y = currentCell.rect.bottom + 5; y < nextCell.rect.top; y += 15) {
                            const elementsAtPoint = document.elementsFromPoint(colX, y);
                            
                            for (const element of elementsAtPoint.slice(0, 8)) {
                                const cell = this.findTargetCell(element);
                                if (cell && !this.selectedCells.has(cell) && 
                                    this.cellHasNumber(cell) && !currentCell.cell.contains(cell) && 
                                    !nextCell.cell.contains(cell)) {
                                    this.addCellToSelection(cell);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[SumCalc] Error filling column gaps:', err);
        }
    }
    
    // Fill gaps in rows (horizontal alignment)
    fillRowGaps(cellsArray) {
        try {
            // Group cells by approximate Y position (row)
            const rowGroups = new Map();
            const rowTolerance = 10; // pixels
            
            // Create row groups
            cellsArray.forEach(cell => {
                if (!cell || !cell.isConnected) return;
                
                const rect = cell.getBoundingClientRect();
                const centerY = rect.top + (rect.height / 2);
                
                // Find a matching row or create a new one
                let foundRow = false;
                for (const [rowY, cells] of rowGroups.entries()) {
                    if (Math.abs(centerY - rowY) < rowTolerance) {
                        cells.push({ cell, rect, centerX: rect.left + (rect.width / 2) });
                        foundRow = true;
                        break;
                    }
                }
                
                if (!foundRow) {
                    rowGroups.set(centerY, [{ cell, rect, centerX: rect.left + (rect.width / 2) }]);
                }
            });
            
            // Process each row to fill gaps
            for (const [rowY, cells] of rowGroups.entries()) {
                if (cells.length < 2) continue; // Need at least 2 cells to find gaps
                
                // Sort cells by X position
                cells.sort((a, b) => a.centerX - b.centerX);
                
                // Look for gaps between consecutive cells
                for (let i = 0; i < cells.length - 1; i++) {
                    const currentCell = cells[i];
                    const nextCell = cells[i + 1];
                    
                    // Calculate gap size
                    const gap = nextCell.rect.left - currentCell.rect.right;
                    const avgWidth = (currentCell.rect.width + nextCell.rect.width) / 2;
                    
                    // If gap is significant but not too large
                    if (gap > avgWidth * 0.3 && gap < avgWidth * 4) {
                        // Scan the gap area to find missing cells
                        for (let x = currentCell.rect.right + 5; x < nextCell.rect.left; x += 15) {
                            const elementsAtPoint = document.elementsFromPoint(x, rowY);
                            
                            for (const element of elementsAtPoint.slice(0, 8)) {
                                const cell = this.findTargetCell(element);
                                if (cell && !this.selectedCells.has(cell) && 
                                    this.cellHasNumber(cell) && !currentCell.cell.contains(cell) && 
                                    !nextCell.cell.contains(cell)) {
                                    this.addCellToSelection(cell);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[SumCalc] Error filling row gaps:', err);
        }
    }
    
    // Fill corner gaps in tables (when multiple rows and columns are selected)
    fillCornerGaps(cellsArray) {
        try {
            // Simple check if we have a significant selection (might be a table)
            if (cellsArray.length < 5) return;
            
            // Get all cell positions
            const cellPositions = cellsArray.map(cell => {
                if (!cell || !cell.isConnected) return null;
                
                const rect = cell.getBoundingClientRect();
                return {
                    cell,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    centerX: rect.left + (rect.width / 2),
                    centerY: rect.top + (rect.height / 2),
                    width: rect.width,
                    height: rect.height
                };
            }).filter(Boolean);
            
            // Get min/max for bounds of the table
            const allXCoords = cellPositions.map(pos => pos.centerX);
            const allYCoords = cellPositions.map(pos => pos.centerY);
            
            const minX = Math.min(...allXCoords);
            const maxX = Math.max(...allXCoords);
            const minY = Math.min(...allYCoords);
            const maxY = Math.max(...allYCoords);
            
            // Get average cell dimensions
            const avgWidth = cellPositions.reduce((sum, pos) => sum + pos.width, 0) / cellPositions.length;
            const avgHeight = cellPositions.reduce((sum, pos) => sum + pos.height, 0) / cellPositions.length;
            
            // Sample points in the selection area to find missing cells in the table grid
            const samples = 20; // number of samples in each dimension
            
            for (let i = 0; i <= samples; i++) {
                for (let j = 0; j <= samples; j++) {
                    // Interpolate coordinates
                    const x = minX + (maxX - minX) * (i / samples);
                    const y = minY + (maxY - minY) * (j / samples);
                    
                    // Check if point is inside selection area but not too close to existing cells
                    if (x > minX && x < maxX && y > minY && y < maxY) {
                        // Check if we're too close to a selected cell to avoid duplicate scanning
                        let tooClose = false;
                        for (const pos of cellPositions) {
                            if (Math.abs(x - pos.centerX) < avgWidth * 0.4 && 
                                Math.abs(y - pos.centerY) < avgHeight * 0.4) {
                                tooClose = true;
                                break;
                            }
                        }
                        
                        if (!tooClose) {
                            // Sample this spot for missing cells
                            const elementsAtPoint = document.elementsFromPoint(x, y);
                            
                            for (const element of elementsAtPoint.slice(0, 5)) {
                                const cell = this.findTargetCell(element);
                                if (cell && !this.selectedCells.has(cell) && this.cellHasNumber(cell)) {
                                    this.addCellToSelection(cell);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('[SumCalc] Error filling corner gaps:', err);
        }
    }

    // Helper to clear selection properly with better cleanup
    clearSelection() {
        // Remove highlighting from all cells
        this.selectedCells.forEach(cell => {
            cell.classList.remove('sum-calculator-cell-highlight');
            // Clean up any custom properties we added
            delete cell._isOriginCell;
        });
        
        // Clear all tracking collections
        this.selectedCells.clear();
        this.highlightedElements.clear();
        
        // Reset all tracking variables
        this.lastVisitedCell = null;
        this.initialCell = null;
        this.initialCellValue = null;
        this._lastDirection = null;
        this._initialScrollY = null;
        this._lastScrollY = null;
        this._lastSelectedCellsArray = null;
        this._lastSelectionSnapshot = null;
        
        // Reset any debug markers if they exist
        this.removeDebugMarkers();
    }
    
    // Optional debug methods for troubleshooting
    showDebugMarker(x, y, color = 'red') {
        const marker = document.createElement('div');
        marker.className = 'calculator-debug-marker';
        marker.style.cssText = `
            position: fixed;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: ${color};
            z-index: 999999;
            pointer-events: none;
            opacity: 0.7;
            left: ${x - 5}px;
            top: ${y - 5}px;
        `;
        
        // Store reference to remove later
        this._debugMarkers = this._debugMarkers || [];
        this._debugMarkers.push(marker);
        
        document.body.appendChild(marker);
        return marker;
    }
    
    removeDebugMarkers() {
        if (this._debugMarkers && this._debugMarkers.length) {
            this._debugMarkers.forEach(marker => {
                if (marker && marker.parentNode) {
                    marker.parentNode.removeChild(marker);
                }
            });
            this._debugMarkers = [];
        }
    }

    // Update handleMouseUp to properly clean up
    handleMouseUp(event) {
        if (!this.isSelectingCells) return;
        if (event.button !== 0) return;
        
        // Cancel any pending animation frame
        if (this.pendingRaf) {
            cancelAnimationFrame(this.pendingRaf);
            this.pendingRaf = null;
        }
        
        // Clean up state
        this.isSelectingCells = false;
        this._lastScrollY = null; // Reset scroll tracking
        document.body.style.userSelect = '';
        
        // Don't clear selection here - keep it until new selection starts
    }

    // Add new method to remove a cell from selection
    removeCellFromSelection(cell) {
        if (cell && this.selectedCells.has(cell)) {
            // Never remove the origin cell
            if (cell === this.initialCell) return false;
            
            this.selectedCells.delete(cell);
            cell.classList.remove('sum-calculator-cell-highlight');
            this.highlightedElements.delete(cell);
            return true;
        }
        return false;
    }

    // Update addCellToSelection with optional forceAdd parameter
    addCellToSelection(cell, forceAdd = false) {
        if ((cell && !this.selectedCells.has(cell)) || forceAdd) {
            this.selectedCells.add(cell);
            cell.classList.add('sum-calculator-cell-highlight');
            this.highlightedElements.add(cell);
            return true;
        }
        return false;
    }

    processSelectedCells() {
        console.log('[SumCalc] Processing cells:', this.selectedCells.size); 
        const numbers = [];
        this.selectedCells.forEach(cell => {
            const num = this.extractNumberFromCell(cell);
            if (num !== null) { numbers.push(num); }
        });
        console.log('[SumCalc] Extracted numbers:', numbers);
        this.updateResult(numbers); 
    }

    calculateResult(numbers) {
        const count = numbers.length;
        if (count === 0) return { 
            sum: 0, average: 0, min: 0, max: 0, count: 0, 
            positiveCount: 0, negativeCount: 0, zeroCount: 0 
        };

        let sum = 0;
        let positiveCount = 0;
        let negativeCount = 0;
        let zeroCount = 0;
        let min = numbers[0];
        let max = numbers[0];

        for (const num of numbers) {
            sum += num;
            if (num > 0) positiveCount++;
            else if (num < 0) negativeCount++;
            else zeroCount++; // Count zeros separately
            
            if (num < min) min = num;
            if (num > max) max = num;
        }

        const avg = sum / count;

        return {
            sum, average: avg, min, max, count, 
            positiveCount, negativeCount, zeroCount 
        };
    }

    formatSingleNumber(value, type = 'number') {
        const formatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
        const numberFormat = this.settings.format || 'plain';

        if (type === 'count') {
            formatOptions.minimumFractionDigits = 0;
            formatOptions.maximumFractionDigits = 0;
        } else if (numberFormat === 'percentage') {
            formatOptions.style = 'percent';
        }
        // For currency format, we detect the symbol from the data

        if (isNaN(value) || !isFinite(value)) {
            return type === 'count' ? '0' : '--';
        }

        // Format the number 
        let formatted = new Intl.NumberFormat(undefined, formatOptions).format(value);
        
        // Handle currency format by detecting symbols from cells
        if (numberFormat === 'currency' && type !== 'count') {
            const currencySymbol = this.detectCurrencySymbol();
            if (currencySymbol) {
                formatted = currencySymbol + formatted;
            }
        }
        
        return formatted;
    }
    
    // Helper to detect currency symbols from the data
    detectCurrencySymbol() {
        // Use cached detection if available
        if (this._detectedCurrencySymbol) {
            return this._detectedCurrencySymbol;
        }
        
        // Common currency symbols
        const symbols = ['£', '€', '$', '¥', '₹', '₽', 'kr', 'R$', '₩', 'CHF'];
        
        // Check selected cells for currency symbols
        if (this.selectedCells.size > 0) {
            for (const cell of this.selectedCells) {
                const text = cell.textContent || '';
                
                for (const symbol of symbols) {
                    if (text.includes(symbol)) {
                        // Cache and return the detected symbol
                        this._detectedCurrencySymbol = symbol;
                        return symbol;
                    }
                }
            }
        }
        
        // If no symbol found, don't add any
        return '';
    }

    updateResult(numbers) {
        if (!this.overlay || !this.isVisible) return;

        const startTime = performance.now();
        const result = this.calculateResult(numbers);
        this.lastResult = result;
        const endTime = performance.now();
        const calculationTime = endTime - startTime;

        // Update metric values with smooth transitions
        this.updateMetricWithTransition('#sum-value', this.formatSingleNumber(result.sum));
        this.updateMetricWithTransition('#avg-value', this.formatSingleNumber(result.average));
        this.updateMetricWithTransition('#min-value', this.formatSingleNumber(result.min));
        this.updateMetricWithTransition('#max-value', this.formatSingleNumber(result.max));
        
        // Update count display
        const totalText = this.formatSingleNumber(result.count, 'count');
        
        // Always update the total count
        this.updateMetricWithTransition('#total-count', totalText);
        
        // Show or hide the detailed breakdown based on whether we have values
        const countBreakdown = this.overlay.querySelector('.count-breakdown');
        if (!countBreakdown) return;
        
        if (result.count > 0) {
            // Show breakdown with proper animations
            countBreakdown.style.display = 'inline-flex';
            if (countBreakdown.style.opacity !== '1') {
                requestAnimationFrame(() => {
                    countBreakdown.style.opacity = '1';
                });
            }
            
            // Update individual counts
            this.updateMetricWithTransition('#pos-count', result.positiveCount);
            this.updateMetricWithTransition('#zero-count', result.zeroCount);
            this.updateMetricWithTransition('#neg-count', result.negativeCount);
            
            // Add visual emphasis to counts that are significant
            const posCount = this.overlay.querySelector('.positive-count');
            const zeroCount = this.overlay.querySelector('.zero-count');
            const negCount = this.overlay.querySelector('.negative-count');
            
            if (posCount) posCount.classList.toggle('count-significant', result.positiveCount > 0);
            if (zeroCount) zeroCount.classList.toggle('count-significant', result.zeroCount > 0);
            if (negCount) negCount.classList.toggle('count-significant', result.negativeCount > 0);
        } else {
            // Hide breakdown with animation
            if (countBreakdown.style.opacity !== '0') {
                countBreakdown.style.opacity = '0';
                setTimeout(() => {
                    if (this.lastResult.count === 0) { // Only hide if still no values
                        countBreakdown.style.display = 'none';
                    }
                }, 300);
            }
        }

        this.logStats(calculationTime, result);
    }
    
    // Helper method for smooth transitions in metric updates
    updateMetricWithTransition(selector, value) {
        const element = this.overlay.querySelector(selector);
        if (!element) return;
        
        // Only animate if the value changed
        if (element.textContent !== value.toString()) {
            // Apply a subtle animation
            element.classList.add('metric-update');
            element.textContent = value;
            
            // Remove animation class after transition completes
            setTimeout(() => {
                element.classList.remove('metric-update');
            }, 300);
        }
    }

    showOverlay() {
        if (!this.overlay) {
            this.createOverlay();
        }
        if (this.overlay) {
            this.isVisible = true;
            this.applyCurrentPosition();
            this.overlay.style.display = 'block';
            this.overlay.classList.remove('calculator-fade-out');
        this.overlay.classList.add('calculator-fade-in');
            this.overlay.offsetHeight;
            console.log('Overlay shown');
        }
    }

    hideOverlay() {
        this.isVisible = false;
        if (this.overlay && this.overlay.style.display !== 'none') {
            this.overlay.classList.remove('calculator-fade-in');
            this.overlay.classList.add('calculator-fade-out');
            const handleAnimationEnd = () => {
                if (this.overlay && !this.isVisible) {
                    this.overlay.style.display = 'none';
                    this.clearResultDisplay();
                }
            };
            this.overlay.addEventListener('animationend', handleAnimationEnd, { once: true });
            setTimeout(() => {
                if (this.overlay && this.overlay.classList.contains('calculator-fade-out') && !this.isVisible) {
                    this.overlay.removeEventListener('animationend', handleAnimationEnd);
                    this.overlay.style.display = 'none';
                    this.clearResultDisplay();
                }
            }, 300);
        }
        console.log('Overlay hidden');
    }

    copyAllResult() {
        if (!this.overlay || !this.isVisible) return;
        
        // Format numbers according to the current settings
        const formatNum = (val) => this.formatSingleNumber(val);
        
        // Create a more detailed and well-formatted text representation
        const lines = [
            `SUM: ${formatNum(this.lastResult.sum)}`,
            `AVERAGE: ${formatNum(this.lastResult.average)}`,
            `MIN: ${formatNum(this.lastResult.min)}`,
            `MAX: ${formatNum(this.lastResult.max)}`,
            `COUNT: ${this.lastResult.count}`,
            `   POSITIVE: ${this.lastResult.positiveCount}`,
            `   ZERO: ${this.lastResult.zeroCount}`,
            `   NEGATIVE: ${this.lastResult.negativeCount}`
        ];
        const textToCopy = lines.join('\n');

        // Try to copy to clipboard with fallback
        try {
            navigator.clipboard.writeText(textToCopy).then(() => {
                this.showCopyFeedback();
            }).catch(err => {
                // Fallback for clipboard write failure
                console.warn('Primary clipboard access failed, trying fallback method', err);
                this.copyTextWithFallback(textToCopy);
            });
        } catch (err) {
            console.error('Failed to copy results: ', err);
            this.copyTextWithFallback(textToCopy);
        }
    }
    
    // Helper method to show copy feedback
    showCopyFeedback() {
        const button = this.overlay.querySelector('[data-action="copy-all"]');
        if (!button) return;
        
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        button.classList.add('copy-success');
        button.disabled = true;
        
        setTimeout(() => { 
            if (button) { 
                button.textContent = originalText; 
                button.disabled = false; 
                button.classList.remove('copy-success');
            } 
        }, 1500);
    }
    
    // Fallback copy method for browsers with restricted clipboard access
    copyTextWithFallback(text) {
        try {
            // Create a temporary textarea element
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';  // Prevent scrolling to bottom
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            
            // Execute copy command
            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);
            
            if (successful) {
                this.showCopyFeedback();
            } else {
                console.error('Fallback copy method failed');
            }
        } catch (err) {
            console.error('All clipboard methods failed', err);
        }
    }

    clearResultDisplay() {
        if (!this.overlay) return;
        
        // Reset all result values
        this.lastResult = { 
            sum: 0, average: 0, min: 0, max: 0, count: 0, 
            positiveCount: 0, negativeCount: 0, zeroCount: 0 
        };
        
        // Reset metric values without animations
        const metrics = ['#sum-value', '#avg-value', '#min-value', '#max-value'];
        metrics.forEach(selector => {
            const element = this.overlay.querySelector(selector);
            if (element) element.textContent = this.formatSingleNumber(0);
        });
        
        // Reset count display
        const totalCount = this.overlay.querySelector('#total-count');
        if (totalCount) totalCount.textContent = '0';
        
        // Reset individual counts
        ['#pos-count', '#zero-count', '#neg-count'].forEach(selector => {
            const element = this.overlay.querySelector(selector);
            if (element) element.textContent = '0';
        });
        
        // Hide the count breakdown
        const countBreakdown = this.overlay.querySelector('.count-breakdown');
        if (countBreakdown) {
            countBreakdown.style.opacity = '0';
            countBreakdown.style.display = 'none';
        }
        
        // Remove any emphasis classes
        ['positive-count', 'zero-count', 'negative-count'].forEach(className => {
            const element = this.overlay.querySelector(`.${className}`);
            if (element) element.classList.remove('count-significant');
        });
    }

    logStats(calculationTime, result) {
        chrome.storage.sync.get(['calculatorStats', 'recentCalculations'], (data) => {
            let stats = data.calculatorStats || { 
                totalCalculations: 0, 
                totalTime: 0, 
                count: 0, 
                savedTime: 0 
            };
            let recent = data.recentCalculations || [];

            // Update stats with performance metrics
            stats.totalCalculations += 1;
            stats.totalTime = (stats.totalTime || 0) + calculationTime;
            stats.count = (stats.count || 0) + 1;
            
            // Calculate estimated time saved (generous estimate)
            // Assume manual calculation takes 5 seconds per operation
            const operations = 5; // SUM, AVG, MIN, MAX, COUNT
            const manualTime = operations * 5; // seconds
            stats.savedTime = (stats.savedTime || 0) + manualTime;
            stats.avgTime = stats.totalTime / stats.count;

            // Create a more comprehensive summary including zeros
            const summary = `Sum: ${this.formatSingleNumber(result.sum)}, Count: ${result.count} (+${result.positiveCount}/0${result.zeroCount}/-${result.negativeCount})`;
            
            // Store more detailed information in recent entries
            const recentEntry = { 
                timestamp: Date.now(), 
                result: summary, 
                mode: 'all', 
                count: result.count,
                positiveCount: result.positiveCount,
                zeroCount: result.zeroCount,
                negativeCount: result.negativeCount,
                sum: result.sum,
                avg: result.average
            };
            
            // Add to recent calculations list
            recent.unshift(recentEntry);
            
            // Keep list to reasonable size
            if (recent.length > 10) {
                recent.pop();
            }

            // Save updates to Chrome storage
            chrome.storage.sync.set({ calculatorStats: stats, recentCalculations: recent });
        });
    }

    findTargetCell(element) {
        // Only try direct element first - avoid checking siblings/parents
        let cell = this.findCellFromElement(element);
        if (cell && this.cellHasNumber(cell)) return cell;
        
        // Only if the element itself has a number in it, check for cell containers
        const text = element.textContent || "";
        if (this.hasNumericValue(text)) {
            // Try the parent only if we have a number in the text
            if (element.parentElement) {
                cell = this.findCellFromElement(element.parentElement);
                if (cell && this.cellHasNumber(cell)) return cell;
            }
        }
        
        return null;
    }
    
    // Improved cell element detection
    findCellFromElement(element) {
        if (!element) return null;
        
        // Try standard table cells first (highest priority)
        let cell = element.closest('td, th');
        if (cell) return cell;

        // Try div-based table patterns with strict validation
        cell = element.closest('.hp-table-cell'); 
        if (cell) return cell;
        
        // Additional patterns for table frameworks (medium priority)
        cell = element.closest('[role="cell"], [role="gridcell"]');
        if (cell) return cell;
        
        // Common table libraries (known patterns)
        cell = element.closest('.ag-cell, .react-grid-Cell, .rt-td, .MuiTableCell-root');
        if (cell) return cell;
        
        // Remove the last resort pattern matching - it's too aggressive
        return null;
    }

    // More precise number detection
    cellHasNumber(cell) {
        if (!cell) return false;
        const text = cell.textContent || "";
        return this.hasNumericValue(text);
    }
    
    // Stricter numeric validation
    hasNumericValue(text) {
        // Clean out non-numeric characters except for decimal points and negatives
        const cleanedText = text.trim().replace(/[^\d.,-]/g, '');
        
        // More precise regex that looks for valid numeric patterns
        // Avoids matching things like empty strings, lone decimals or commas
        const numericPattern = /^-?(?:\d{1,3}(?:[,.]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/;
        const simpleNumber = /^-?\d+(?:\.\d+)?$/;
        
        return numericPattern.test(cleanedText) || simpleNumber.test(cleanedText);
    }

    // Improved extractNumberFromCell with better number detection
    extractNumberFromCell(cell) {
        if (!cell) return null;
        const text = cell.textContent || "";
        
        // Remove currency symbols, thousand separators
        let cleanedText = text.trim().replace(/[^\d.,-]/g, '');
        
        // Handle European number formats (convert comma decimals to periods)
        if (cleanedText.includes(',') && !cleanedText.includes('.')) {
            cleanedText = cleanedText.replace(/,/g, '.');
        } else {
            // Remove thousand separators
            cleanedText = cleanedText.replace(/,/g, '');
        }
        
        // Try to parse the number
        const num = parseFloat(cleanedText);
        return isNaN(num) ? null : num;
    }

    clearHighlights() {
        this.highlightedElements.forEach(el => el.classList.remove('sum-calculator-cell-highlight'));
        this.highlightedElements.clear();
    }
}

// --- Initialization Guard --- 
// Check if an instance already exists in this specific script context
if (typeof window.sumCalculatorInstanceInjected === 'undefined') {
    // Mark this context as having injected
    window.sumCalculatorInstanceInjected = true;
    
    // Create the instance
    // Use a specific name to avoid potential clashes with the page\'s own variables
    window.sumCalculatorProInstance = new SumCalculator();
    console.log("SumCalculator content script initialized.");
} else {
    console.log("SumCalculator content script already initialized, skipping.");
}
// --- End Initialization Guard ---