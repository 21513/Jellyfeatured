// @ts-nocheck
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
    let autoSlideEnabled = false;
    let isUserInteracting = false;
    let imageCache = new Map(); // Cache for all loaded images
    let filteredRecommendations = []; // Only items with required images

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
        
        if (filteredRecommendations.length === 0 || index >= filteredRecommendations.length || index === currentSlide) {
            console.log('[JELLYFEATURED] goToSlide aborted - invalid index or same slide');
            return;
        }
        
        currentSlide = index;
        createInfiniteCarouselItems();
        console.log('[JELLYFEATURED] Slide changed to:', currentSlide);
    }
    
    function updateCarouselDisplay() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        // Clear existing items
        itemsContainer.innerHTML = '';
        
        // Create items for infinite scroll effect (current + next items)
        const itemsToShow = Math.min(recommendations.length, 6); // Show max 6 items
        
        for (let i = 0; i < itemsToShow; i++) {
            const actualIndex = (currentSlide + i) % recommendations.length;
            const recommendation = recommendations[actualIndex];
            
            createCarouselItemInline(recommendation, actualIndex, i === 0).then(item => {
                itemsContainer.appendChild(item);
            });
        }
        
        // Reset and start progress bar
        resetProgressBar();
        startProgressBar();
        
        console.log('[JELLYFEATURED] Carousel display updated, currentSlide:', currentSlide);
    }
    
    async function createCarouselItemInline(recommendation, originalIndex, isPrimary) {
        const item = document.createElement('div');
        item.className = 'featured-item ' + (isPrimary ? 'primary' : 'poster');
        item.setAttribute('data-index', originalIndex);
        item.setAttribute('data-title', recommendation.title);
        item.setAttribute('data-year', recommendation.year || '');
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${recommendation.title}`);

        // Set default background
        item.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

        // Only add content for primary item
        if (isPrimary) {
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
        }

        // Add click handlers
        item.addEventListener('click', async (e) => {
            const clickedIndex = parseInt(item.getAttribute('data-index'));
            if (isPrimary) {
                const title = item.getAttribute('data-title');
                const year = item.getAttribute('data-year');
                await navigateToMedia(title, year);
            } else {
                goToSlide(clickedIndex);
                pauseAutoSlide();
            }
        });

        // Load appropriate image
        try {
            const item_data = await searchForItem(recommendation.title, recommendation.year);
            
            if (item_data) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                
                if (isPrimary && item_data.BackdropImageTags && item_data.BackdropImageTags.length > 0) {
                    // Use backdrop for primary item
                    const backdropUrl = `${baseUrl}/Items/${item_data.Id}/Images/Backdrop?api_key=${apiKey}`;
                    item.style.background = `url("${backdropUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                    
                    // Add logo if available
                    if (item_data.ImageTags && item_data.ImageTags.Logo) {
                        const logoUrl = `${baseUrl}/Items/${item_data.Id}/Images/Logo?api_key=${apiKey}`;
                        const logoImg = item.querySelector('.featuredLogo');
                        if (logoImg) {
                            logoImg.src = logoUrl;
                            logoImg.style.display = 'block';
                        }
                    }
                } else if (!isPrimary && item_data.ImageTags && item_data.ImageTags.Primary) {
                    // Use poster for non-primary items
                    const posterUrl = `${baseUrl}/Items/${item_data.Id}/Images/Primary?api_key=${apiKey}`;
                    item.style.background = `url("${posterUrl}")`;
                    item.style.backgroundSize = 'cover';
                    item.style.backgroundPosition = 'center';
                }
            }
        } catch (e) {
            // Keep gradient background
        }
        
        return item;
    }
    
    
    function nextSlide() {
        const nextIndex = (currentSlide + 1) % filteredRecommendations.length;
        goToSlide(nextIndex);
    }
    
    function previousSlide() {
        const prevIndex = (currentSlide - 1 + filteredRecommendations.length) % filteredRecommendations.length;
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
        if (filteredRecommendations.length > 1) {
            clearInterval(autoSlideInterval);
            autoSlideEnabled = true;
            autoSlideInterval = setInterval(() => {
                if (!isUserInteracting) {
                    nextSlide();
                }
            }, 5000); // Match SLIDE_DURATION
            startProgressBar();
        }
    }
    
    function pauseAutoSlide() {
        isUserInteracting = true;
        autoSlideEnabled = false;
        clearInterval(autoSlideInterval);
        pauseProgressBar();
        
        setTimeout(() => {
            isUserInteracting = false;
            startAutoSlide();
        }, 10000);
    }
    
    async function preloadAndFilterRecommendations() {
        console.log('[JELLYFEATURED] Preloading and filtering recommendations...');
        const apiKey = getJellyfinApiKey();
        const baseUrl = getJellyfinBaseUrl();
        
        if (!apiKey) {
            console.log('[JELLYFEATURED] No API key available for preloading');
            filteredRecommendations = recommendations.slice();
            return;
        }

        const validItems = [];
        const preloadPromises = [];

        for (const recommendation of recommendations) {
            try {
                const item_data = await searchForItem(recommendation.title, recommendation.year);
                
                if (item_data) {
                    const hasBackdrop = item_data.BackdropImageTags && item_data.BackdropImageTags.length > 0;
                    const hasPoster = item_data.ImageTags && item_data.ImageTags.Primary;
                    
                    // Only include items that have both backdrop and poster images
                    if (hasBackdrop && hasPoster) {
                        // Cache the image URLs
                        const backdropUrl = `${baseUrl}/Items/${item_data.Id}/Images/Backdrop?api_key=${apiKey}`;
                        const posterUrl = `${baseUrl}/Items/${item_data.Id}/Images/Primary?api_key=${apiKey}`;
                        
                        let logoUrl = null;
                        if (item_data.ImageTags && item_data.ImageTags.Logo) {
                            logoUrl = `${baseUrl}/Items/${item_data.Id}/Images/Logo?api_key=${apiKey}`;
                        }
                        
                        // Store in cache
                        const cacheKey = `${recommendation.title}_${recommendation.year || ''}`;
                        imageCache.set(cacheKey, {
                            backdrop: backdropUrl,
                            poster: posterUrl,
                            logo: logoUrl,
                            itemData: item_data
                        });
                        
                        validItems.push(recommendation);
                        
                        // Preload images
                        preloadPromises.push(preloadImage(backdropUrl));
                        preloadPromises.push(preloadImage(posterUrl));
                        if (logoUrl) {
                            preloadPromises.push(preloadImage(logoUrl));
                        }
                    }
                }
            } catch (e) {
                console.log('[JELLYFEATURED] Failed to process recommendation:', recommendation.title, e);
            }
        }

        // Wait for all images to preload
        console.log('[JELLYFEATURED] Preloading', preloadPromises.length, 'images...');
        await Promise.allSettled(preloadPromises);
        
        filteredRecommendations = validItems;
        console.log('[JELLYFEATURED] Filtered recommendations:', filteredRecommendations.length, 'of', recommendations.length);
    }
    
    function preloadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(url);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
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
                    // Preload and filter recommendations first
                    await preloadAndFilterRecommendations();
                    
                    if (filteredRecommendations.length === 0) {
                        console.log('[JELLYFEATURED] No valid recommendations with required images');
                        itemsContainer.innerHTML = `
                            <div class="featured-item primary" style="display: flex; align-items: center; justify-content: center; background: var(--cardBackgroundGradient);">
                                <p style="color: var(--textColor); font-size: 1.2rem;">No content available with required images...</p>
                            </div>
                        `;
                        return;
                    }
                    console.log('[JELLYFEATURED] Creating horizontal carousel items for', filteredRecommendations.length, 'items');
                    
                    // Create initial set of items
                    currentSlide = 0;
                    await createInfiniteCarouselItems();

                    // Setup navigation buttons
                    setupNavigation();

                    // Touch event handlers
                    featuredDiv.addEventListener('touchstart', handleTouchStart, { passive: true });
                    featuredDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
                    featuredDiv.addEventListener('touchend', handleTouchEnd, { passive: false });

                    // Auto-slide functionality
                    setTimeout(startAutoSlide, 2000);

                    featuredDiv.addEventListener('mouseenter', () => {
                        pauseAutoSlide();
                        pauseProgressBar();
                    });
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
    
    // Progress bar functionality
    let progressInterval;
    let progressStartTime;
    const SLIDE_DURATION = 5000; // 5 seconds per slide
    
    function resetProgressBar() {
        const progressBar = document.getElementById('featured-progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
        if (progressInterval) {
            clearInterval(progressInterval);
        }
    }
    
    function startProgressBar() {
        const progressBar = document.getElementById('featured-progress-bar');
        if (!progressBar || !autoSlideEnabled) return;
        
        progressStartTime = Date.now();
        
        progressInterval = setInterval(() => {
            const elapsed = Date.now() - progressStartTime;
            const progress = Math.min((elapsed / SLIDE_DURATION) * 100, 100);
            progressBar.style.width = progress + '%';
            
            if (progress >= 100) {
                clearInterval(progressInterval);
            }
        }, 50);
    }
    
    function pauseProgressBar() {
        if (progressInterval) {
            clearInterval(progressInterval);
        }
    }
    
    async function createInfiniteCarouselItems() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        // Clear existing items
        itemsContainer.innerHTML = '';
        
        // Create items for infinite scroll effect (show current + next few items)
        const itemsToShow = Math.min(filteredRecommendations.length, 6);
        
        for (let i = 0; i < itemsToShow; i++) {
            const actualIndex = (currentSlide + i) % filteredRecommendations.length;
            const recommendation = filteredRecommendations[actualIndex];
            
            const item = createCarouselItemInlineFromCache(recommendation, actualIndex, i === 0);
            itemsContainer.appendChild(item);
        }
        
        // Reset and start progress bar
        resetProgressBar();
        startProgressBar();
        
        console.log('[JELLYFEATURED] Infinite carousel items created for slide:', currentSlide);
    }
    
    function createCarouselItemInlineFromCache(recommendation, originalIndex, isPrimary) {
        const item = document.createElement('div');
        item.className = 'featured-item ' + (isPrimary ? 'primary' : 'poster');
        item.setAttribute('data-index', originalIndex);
        item.setAttribute('data-title', recommendation.title);
        item.setAttribute('data-year', recommendation.year || '');
        item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', `View ${recommendation.title}`);

        // Get cached image data
        const cacheKey = `${recommendation.title}_${recommendation.year || ''}`;
        const cachedImages = imageCache.get(cacheKey);

        if (cachedImages) {
            if (isPrimary) {
                // Use backdrop for primary item
                item.style.background = `url("${cachedImages.backdrop}")`;
                item.style.backgroundSize = 'cover';
                item.style.backgroundPosition = 'center';
                
                // Add content for primary item
                item.innerHTML = `
                    <div class="featuredContent">
                        <div class="featuredLogoContainer">
                            <img class="featuredLogo" style="display: ${cachedImages.logo ? 'block' : 'none'};" alt="${recommendation.title} logo" ${cachedImages.logo ? `src="${cachedImages.logo}"` : ''} />
                        </div>
                        <div class="featuredText">
                            <div class="featuredTitle">${recommendation.title} ${recommendation.year ? '(' + recommendation.year + ')' : ''}</div>
                            <div class="featuredSubtitle">${recommendation.type}</div>
                            <div class="slideRating">⭐ ${recommendation.rating}</div>
                        </div>
                    </div>
                `;
            } else {
                // Use poster for non-primary items
                item.style.background = `url("${cachedImages.poster}")`;
                item.style.backgroundSize = 'cover';
                item.style.backgroundPosition = 'center';
            }
        } else {
            // Fallback background if not in cache
            item.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        }

        // Add click handlers
        item.addEventListener('click', async (e) => {
            const clickedIndex = parseInt(item.getAttribute('data-index'));
            if (isPrimary) {
                const title = item.getAttribute('data-title');
                const year = item.getAttribute('data-year');
                await navigateToMedia(title, year);
            } else {
                goToSlide(clickedIndex);
                pauseAutoSlide();
                pauseProgressBar();
            }
        });
        
        return item;
    }
    
    // Legacy function for compatibility - now redirects to cached version
    async function createCarouselItemInline(recommendation, originalIndex, isPrimary) {
        return createCarouselItemInlineFromCache(recommendation, originalIndex, isPrimary);
    }
    
    // Initial call
    console.log('[JELLYFEATURED] Making initial call to createFeaturedCarousel...');
    setTimeout(() => createFeaturedCarousel(), 1000);
})();