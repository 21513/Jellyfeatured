const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

// Debug logging
console.log('[JELLYFEATURED] Script loaded successfully!');
console.log('[JELLYFEATURED] Recommendations count:', recommendations.length);
console.log('[JELLYFEATURED] Sample recommendation:', recommendations[0] || 'None');
console.log('[JELLYFEATURED] HTML template length:', htmlTemplate.length);

// Global marker for verification
window.JellyfeaturedLoaded = true;
window.JellyfeaturedVersion = '1.0.0-debug';
console.log('[JELLYFEATURED] Global markers set - check window.JellyfeaturedLoaded');

(function() {
    let currentSlide = 0;
    let autoSlideInterval;
    let isUserInteracting = false;

    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    let isSwiping = false;
    const minSwipeDistance = 50;
    const maxVerticalSwipe = 100;
    
    function getJellyfinApiKey() {
        try {
            if (window.ApiClient && window.ApiClient.accessToken) {
                return window.ApiClient.accessToken();
            }
            
            const authData = localStorage.getItem('jellyfin_credentials');
            if (authData) {
                const parsed = JSON.parse(authData);
                if (parsed.Servers && parsed.Servers.length > 0) {
                    return parsed.Servers[0].AccessToken;
                }
                return parsed.AccessToken || parsed.accessToken;
            }
        } catch (e) {
            // Could not retrieve API key
        }
        return null;
    }
    
    function getJellyfinBaseUrl() {
        try {
            if (window.ApiClient && window.ApiClient.serverAddress) {
                return window.ApiClient.serverAddress();
            }
            return window.location.origin;
        } catch (e) {
            return window.location.origin;
        }
    }
    
    async function searchForItem(title, year) {
        const apiKey = getJellyfinApiKey();
        const baseUrl = getJellyfinBaseUrl();
        
        if (!apiKey) {
            return null;
        }
        
        try {
            const searchUrl = `${baseUrl}/Items?searchTerm=${encodeURIComponent(title)}&Recursive=true&Fields=PrimaryImageAspectRatio,BackdropImageTags,ImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo&Limit=5&api_key=${apiKey}`;
            
            const response = await fetch(searchUrl);
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }
            
            const data = await response.json();
            if (data.Items && data.Items.length > 0) {
                let bestMatch = data.Items[0];
                
                if (year) {
                    const yearMatch = data.Items.find(item => 
                        item.PremiereDate && new Date(item.PremiereDate).getFullYear().toString() === year
                    );
                    if (yearMatch) {
                        bestMatch = yearMatch;
                    }
                }
                
                return bestMatch;
            }
        } catch (e) {
            // Search failed
        }
        
        return null;
    }
    
    function getPosterImageUrl(title, year) {
        return searchForItem(title, year).then(item => {
            if (item && item.ImageTags && item.ImageTags.Primary) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                return `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}`;
            } else {
                const colors = [
                    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 
                    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
                ];
                const hash = title.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
                return colors[Math.abs(hash) % colors.length];
            }
        }).catch(() => {
            return `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        });
    }
    
    function getBackdropImageUrl(title, year) {
        return searchForItem(title, year).then(item => {
            if (item && item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                return `url("${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}")`;
            } else {
                const colors = [
                    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 
                    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
                ];
                const hash = title.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
                return colors[Math.abs(hash) % colors.length];
            }
        }).catch(() => {
            return `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        });
    }
    
    async function createCarouselItem(recommendation, index) {
        const item = document.createElement('div');
        item.className = 'featured-item';
        item.setAttribute('data-index', index);
        item.setAttribute('data-title', recommendation.title);
        item.setAttribute('data-year', recommendation.year || '');
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${recommendation.title}`);

        // First item is primary (16:9), others are posters (4:5)
        if (index === 0) {
            item.classList.add('primary');
        } else {
            item.classList.add('poster');
        }

        item.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

        item.innerHTML = `
            <div class="featuredContent">
                <div class="featuredLogoContainer">
                    <img class="featuredLogo" style="display: none;" alt="${recommendation.title} logo" />
                </div>
                <div class="featuredText">
                    <div class="featuredTitle">${recommendation.title} ${recommendation.year ? '(' + recommendation.year + ')' : ''}</div>
                    <div class="featuredSubtitle">${recommendation.type}</div>
                    <div class="slideRating">⭐ ${recommendation.rating}</div>
                </div>
            </div>
        `;

        try {
            const item_data = await searchForItem(recommendation.title, recommendation.year);
            
            if (item_data) {
                // Use backdrop for primary item, poster for others
                if (index === 0 && item_data.BackdropImageTags && item_data.BackdropImageTags.length > 0) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const backdropUrl = `${baseUrl}/Items/${item_data.Id}/Images/Backdrop?api_key=${apiKey}`;
                    item.style.background = `url("${backdropUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                    item.style.backgroundRepeat = 'no-repeat';
                } else if (index > 0 && item_data.ImageTags && item_data.ImageTags.Primary) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const posterUrl = `${baseUrl}/Items/${item_data.Id}/Images/Primary?api_key=${apiKey}`;
                    item.style.background = `url("${posterUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                    item.style.backgroundRepeat = 'no-repeat';
                }
                
                // Show logo only for primary item
                if (index === 0 && item_data.ImageTags && item_data.ImageTags.Logo) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const logoUrl = `${baseUrl}/Items/${item_data.Id}/Images/Logo?api_key=${apiKey}`;
                    const logoImg = item.querySelector('.featuredLogo');
                    logoImg.src = logoUrl;
                    logoImg.style.display = 'block';
                }
            }
        } catch (e) {
            const colors = [
                'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 
                'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
            ];
            const hash = recommendation.title.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
            item.style.background = colors[Math.abs(hash) % colors.length];
        }
        
        return item;
    }
    
    function setupNavigation() {
        console.log('[JELLYFEATURED] Setting up navigation buttons');
        const prevButton = document.getElementById('featured-prev');
        const nextButton = document.getElementById('featured-next');
        
        console.log('[JELLYFEATURED] Prev button found:', !!prevButton);
        console.log('[JELLYFEATURED] Next button found:', !!nextButton);
        
        if (prevButton) {
            // Remove any existing listeners
            prevButton.replaceWith(prevButton.cloneNode(true));
            const newPrevButton = document.getElementById('featured-prev');
            
            newPrevButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[JELLYFEATURED] Previous button clicked');
                previousSlide();
                pauseAutoSlide();
            });
            
            newPrevButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[JELLYFEATURED] Previous button key pressed');
                    previousSlide();
                    pauseAutoSlide();
                }
            });
        }
        
        if (nextButton) {
            // Remove any existing listeners
            nextButton.replaceWith(nextButton.cloneNode(true));
            const newNextButton = document.getElementById('featured-next');
            
            newNextButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[JELLYFEATURED] Next button clicked');
                nextSlide();
                pauseAutoSlide();
            });
            
            newNextButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[JELLYFEATURED] Next button key pressed');
                    nextSlide();
                    pauseAutoSlide();
                }
            });
        }
        
        console.log('[JELLYFEATURED] Navigation setup complete');
    }
    
    function goToSlide(index) {
        console.log('[JELLYFEATURED] goToSlide called with index:', index, 'current:', currentSlide);
        
        if (recommendations.length === 0 || index >= recommendations.length || index === currentSlide) {
            console.log('[JELLYFEATURED] goToSlide aborted - invalid index or same slide');
            return;
        }
        
        currentSlide = index;
        updateCarouselDisplay();
        console.log('[JELLYFEATURED] Slide changed to:', currentSlide);
    }
    
    function updateCarouselDisplay() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        // Re-order items so current slide is first
        const items = Array.from(itemsContainer.children);
        
        // Remove all items
        items.forEach(item => item.remove());
        
        // Create new ordering starting with current slide
        const reorderedItems = [];
        for (let i = 0; i < recommendations.length; i++) {
            const actualIndex = (currentSlide + i) % recommendations.length;
            const item = items.find(item => item.getAttribute('data-index') == actualIndex);
            if (item) {
                // Update classes: first item is primary, others are posters
                item.className = 'featured-item ' + (i === 0 ? 'primary' : 'poster');
                
                // Update image type based on position
                updateItemImage(item, recommendations[actualIndex], i);
                reorderedItems.push(item);
            }
        }
        
        // Re-append items in new order
        reorderedItems.forEach(item => itemsContainer.appendChild(item));
        
        // Scroll back to start
        itemsContainer.scrollLeft = 0;
        
        console.log('[JELLYFEATURED] Carousel display updated, currentSlide:', currentSlide);
    }
    
    async function updateItemImage(item, recommendation, displayIndex) {
        try {
            const item_data = await searchForItem(recommendation.title, recommendation.year);
            
            if (item_data) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                
                // Use backdrop for primary item (index 0), poster for others
                if (displayIndex === 0 && item_data.BackdropImageTags && item_data.BackdropImageTags.length > 0) {
                    const backdropUrl = `${baseUrl}/Items/${item_data.Id}/Images/Backdrop?api_key=${apiKey}`;
                    item.style.background = `url("${backdropUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                    item.style.backgroundRepeat = 'no-repeat';
                    
                    // Show logo for primary item
                    if (item_data.ImageTags && item_data.ImageTags.Logo) {
                        const logoUrl = `${baseUrl}/Items/${item_data.Id}/Images/Logo?api_key=${apiKey}`;
                        const logoImg = item.querySelector('.featuredLogo');
                        if (logoImg) {
                            logoImg.src = logoUrl;
                            logoImg.style.display = 'block';
                        }
                    }
                } else if (displayIndex > 0 && item_data.ImageTags && item_data.ImageTags.Primary) {
                    const posterUrl = `${baseUrl}/Items/${item_data.Id}/Images/Primary?api_key=${apiKey}`;
                    item.style.background = `url("${posterUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                    item.style.backgroundRepeat = 'no-repeat';
                    
                    // Hide logo for poster items
                    const logoImg = item.querySelector('.featuredLogo');
                    if (logoImg) {
                        logoImg.style.display = 'none';
                    }
                }
            }
        } catch (e) {
            // Fallback to gradient background
        }
    }
    
    function nextSlide() {
        const nextIndex = (currentSlide + 1) % recommendations.length;
        goToSlide(nextIndex);
    }
    
    function previousSlide() {
        const prevIndex = (currentSlide - 1 + recommendations.length) % recommendations.length;
        goToSlide(prevIndex);
    }

    function handleTouchStart(e) {
        const featuredDiv = document.getElementById('jellyfeatured_div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            return;
        }
        
        // Only handle touches on mobile devices
        if (window.innerWidth > 768) {
            return;
        }
        
        const touch = e.touches[0] || e.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        isSwiping = false;
        pauseAutoSlide();
        console.log('[JELLYFEATURED] Touch start at:', startX, startY);
    }
    
    function handleTouchMove(e) {
        if (!startX || !startY) return;
        
        const featuredDiv = document.getElementById('jellyfeatured_div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            return;
        }
        
        // Only handle touches on mobile devices
        if (window.innerWidth > 768) {
            return;
        }
        
        const touch = e.touches[0] || e.changedTouches[0];
        endX = touch.clientX;
        endY = touch.clientY;
        
        const deltaX = Math.abs(startX - endX);
        const deltaY = Math.abs(startY - endY);

        if (deltaX > 15 && deltaX > deltaY) {
            e.preventDefault();
            e.stopPropagation();
            isSwiping = true;
            console.log('[JELLYFEATURED] Swiping detected, deltaX:', deltaX);
        }
    }
    
    function handleTouchEnd(e) {
        if (!startX || !startY) {
            return;
        }
        
        const featuredDiv = document.getElementById('jellyfeatured_div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            startX = 0;
            startY = 0;
            endX = 0;
            endY = 0;
            isSwiping = false;
            return;
        }
        
        // Only handle touches on mobile devices
        if (window.innerWidth > 768) {
            startX = 0;
            startY = 0;
            endX = 0;
            endY = 0;
            isSwiping = false;
            return;
        }
        
        if (isSwiping) {
            e.preventDefault();
            e.stopPropagation();
            
            const deltaX = startX - endX;
            const deltaY = Math.abs(startY - endY);

            console.log('[JELLYFEATURED] Swipe end, deltaX:', deltaX, 'deltaY:', deltaY);

            if (Math.abs(deltaX) > minSwipeDistance && deltaY < maxVerticalSwipe) {
                if (deltaX > 0) {
                    console.log('[JELLYFEATURED] Swiped left - next slide');
                    nextSlide();
                } else {
                    console.log('[JELLYFEATURED] Swiped right - previous slide');
                    previousSlide();
                }
            }
        }
        
        startX = 0;
        startY = 0;
        endX = 0;
        endY = 0;
        isSwiping = false;
    }
    
    function startAutoSlide() {
        if (recommendations.length > 1) {
            clearInterval(autoSlideInterval);
            autoSlideInterval = setInterval(() => {
                if (!isUserInteracting) {
                    nextSlide();
                }
            }, 6000);
        }
    }
    
    function pauseAutoSlide() {
        isUserInteracting = true;
        clearInterval(autoSlideInterval);
        
        setTimeout(() => {
            isUserInteracting = false;
            startAutoSlide();
        }, 10000);
    }
    
    async function navigateToMedia(title, year) {
        try {
            const item = await searchForItem(title, year);
            if (item && item.Id) {
                const detailUrl = `${window.location.origin}/web/index.html#!/details?id=${item.Id}`;
                window.location.href = detailUrl;
                return;
            }
        } catch (e) {
            // Failed to find item for navigation
        }
        
        const searchQuery = encodeURIComponent(title);
        const searchUrl = `${window.location.origin}/web/index.html#!/search.html?query=${searchQuery}`;
        window.location.href = searchUrl;
    }
    
    async function createFeaturedCarousel() {
        console.log('[JELLYFEATURED] createFeaturedCarousel() called');
        console.log('[JELLYFEATURED] Current pathname:', window.location.pathname);
        
        if (document.getElementById('jellyfeatured_div')) {
            console.log('[JELLYFEATURED] Featured div already exists, skipping');
            return;
        }
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            console.log('[JELLYFEATURED] Not on home page, skipping. Path:', pathname);
            return;
        }
        
        const targetContainer = document.querySelector('.homePage');
        console.log('[JELLYFEATURED] Target container found:', !!targetContainer);
        if (!targetContainer) {
            console.log('[JELLYFEATURED] No .homePage container found');
            return;
        }
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlTemplate;
        const featuredDiv = tempDiv.firstElementChild;
        console.log('[JELLYFEATURED] Template processed, featuredDiv created:', !!featuredDiv);
            
            if (featuredDiv) {
                console.log('[JELLYFEATURED] Looking for items container');
                const itemsContainer = featuredDiv.querySelector('#featured-items-container');
                console.log('[JELLYFEATURED] Items container found:', !!itemsContainer);
                console.log('[JELLYFEATURED] Recommendations available:', recommendations.length);
                
                if (itemsContainer && recommendations.length > 0) {
                    console.log('[JELLYFEATURED] Creating horizontal carousel items for', recommendations.length, 'items');
                    
                    // Create all items
                    const itemPromises = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const rec = recommendations[i];
                        itemPromises.push(createCarouselItem(rec, i));
                    }

                    console.log('[JELLYFEATURED] Waiting for item creation...');
                    const items = await Promise.all(itemPromises);
                    console.log('[JELLYFEATURED] Items created:', items.length);

                    items.forEach((item, index) => {
                        itemsContainer.appendChild(item);
                        
                        // Add click handler for each item
                        item.addEventListener('click', async (e) => {
                            const originalIndex = parseInt(item.getAttribute('data-index'));
                            console.log('[JELLYFEATURED] Item clicked - original index:', originalIndex, 'current slide:', currentSlide);
                            
                            // If clicking the primary item (leftmost), navigate to media
                            if (item.classList.contains('primary')) {
                                const title = item.getAttribute('data-title');
                                const year = item.getAttribute('data-year');
                                await navigateToMedia(title, year);
                            } else {
                                // Otherwise, make this item the primary one
                                goToSlide(originalIndex);
                                pauseAutoSlide();
                            }
                        });

                        item.addEventListener('keydown', async (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                const originalIndex = parseInt(item.getAttribute('data-index'));
                                console.log('[JELLYFEATURED] Item key pressed - original index:', originalIndex);
                                
                                // Same logic for keyboard interaction
                                if (item.classList.contains('primary')) {
                                    const title = item.getAttribute('data-title');
                                    const year = item.getAttribute('data-year');
                                    await navigateToMedia(title, year);
                                } else {
                                    goToSlide(originalIndex);
                                    pauseAutoSlide();
                                }
                            }
                        });
                    });

                    // Initialize with first item
                    currentSlide = 0;
                    updateCarouselDisplay();

                    // Setup navigation buttons
                    setupNavigation();

                    // Touch event handlers
                    featuredDiv.addEventListener('touchstart', handleTouchStart, { passive: true });
                    featuredDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
                    featuredDiv.addEventListener('touchend', handleTouchEnd, { passive: false });

                    // Auto-slide functionality
                    setTimeout(startAutoSlide, 2000);

                    featuredDiv.addEventListener('mouseenter', pauseAutoSlide);
                    featuredDiv.addEventListener('mouseleave', () => {
                        if (!isUserInteracting) {
                            startAutoSlide();
                        }
                    });
                    console.log('[JELLYFEATURED] Setting up event handlers and injecting into page...');
                    
                } else if (itemsContainer) {
                    console.log('[JELLYFEATURED] Missing components or no recommendations. Container:', !!itemsContainer, 'Recs:', recommendations.length);
                    itemsContainer.innerHTML = `
                        <div class="featured-item primary" style="display: flex; align-items: center; justify-content: center; background: var(--cardBackgroundGradient);">
                            <p style="color: var(--textColor); font-size: 1.2rem;">Loading recommendations...</p>
                        </div>
                    `;
                }
                
                console.log('[JELLYFEATURED] Injecting featured div into page...');
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
                console.log('[JELLYFEATURED] Featured div injected successfully!');
            } else {
                console.error('[JELLYFEATURED] Failed to create featuredDiv from template');
            }
    }

    console.log('[JELLYFEATURED] Setting up MutationObserver and URL monitoring...');
    const observer = new MutationObserver(() => {
        console.log('[JELLYFEATURED] DOM mutation detected, scheduling carousel creation...');
        setTimeout(() => createFeaturedCarousel(), 500);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('[JELLYFEATURED] URL changed to:', location.href);
            setTimeout(() => createFeaturedCarousel(), 200);
        }
    }, 1000);
    
    // Initial call
    console.log('[JELLYFEATURED] Making initial call to createFeaturedCarousel...');
    setTimeout(() => createFeaturedCarousel(), 1000);
})();