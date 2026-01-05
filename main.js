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
    
    async function createThumbnailItem(recommendation, index) {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'featured-thumbnail';
        thumbnail.setAttribute('data-index', index);
        thumbnail.setAttribute('data-title', recommendation.title);
        thumbnail.setAttribute('data-year', recommendation.year || '');
        thumbnail.setAttribute('tabindex', '0');
        thumbnail.setAttribute('role', 'button');
        thumbnail.setAttribute('aria-label', `View ${recommendation.title}`);

        thumbnail.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

        thumbnail.innerHTML = `
            <div class="thumbnail-title">${recommendation.title}</div>
        `;

        try {
            const item = await searchForItem(recommendation.title, recommendation.year);
            
            if (item && item.ImageTags && item.ImageTags.Primary) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                const posterUrl = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}`;
                thumbnail.style.background = `url("${posterUrl}")`;
                thumbnail.style.backgroundSize = 'cover';
                thumbnail.style.backgroundPosition = 'center';
                thumbnail.style.backgroundRepeat = 'no-repeat';
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
            thumbnail.style.background = colors[Math.abs(hash) % colors.length];
        }
        
        return thumbnail;
    }
    
    async function createFeaturedMainItem(recommendation, index) {
        const mainItem = document.getElementById('featured-main-item');
        if (!mainItem) return;
        
        mainItem.setAttribute('data-index', index);
        mainItem.setAttribute('data-title', recommendation.title);
        mainItem.setAttribute('data-year', recommendation.year || '');
        mainItem.setAttribute('tabindex', '0');
        mainItem.setAttribute('role', 'button');
        mainItem.setAttribute('aria-label', `View ${recommendation.title}`);

        mainItem.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

        mainItem.innerHTML = `
            <div class="featuredContent featured-content-entering">
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
            const item = await searchForItem(recommendation.title, recommendation.year);
            
            if (item) {
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const backdropUrl = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}`;
                    mainItem.style.background = `url("${backdropUrl}")`;
                    mainItem.style.backgroundSize = 'cover';
                    mainItem.style.backgroundPosition = 'center';
                    mainItem.style.backgroundRepeat = 'no-repeat';
                }
                
                if (item.ImageTags && item.ImageTags.Logo) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const logoUrl = `${baseUrl}/Items/${item.Id}/Images/Logo?api_key=${apiKey}`;
                    const logoImg = mainItem.querySelector('.featuredLogo');
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
            mainItem.style.background = colors[Math.abs(hash) % colors.length];
        }
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
        const thumbnails = document.querySelectorAll('.featured-thumbnail');
        
        if (recommendations.length === 0 || index >= recommendations.length || index === currentSlide) {
            console.log('[JELLYFEATURED] goToSlide aborted - invalid index or same slide');
            return;
        }
        
        // Update active thumbnail
        thumbnails.forEach(thumbnail => thumbnail.classList.remove('active'));
        if (thumbnails[index]) {
            thumbnails[index].classList.add('active');
            console.log('[JELLYFEATURED] Thumbnail', index, 'set as active');
        }
        
        // Update main featured item
        createFeaturedMainItem(recommendations[index], index);
        
        currentSlide = index;
        console.log('[JELLYFEATURED] Slide changed to:', currentSlide);
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
                console.log('[JELLYFEATURED] Looking for main item and thumbnails container');
                const mainItem = featuredDiv.querySelector('#featured-main-item');
                const thumbnailsContainer = featuredDiv.querySelector('#featured-thumbnails');
                console.log('[JELLYFEATURED] Main item found:', !!mainItem);
                console.log('[JELLYFEATURED] Thumbnails container found:', !!thumbnailsContainer);
                console.log('[JELLYFEATURED] Recommendations available:', recommendations.length);
                
                if (mainItem && thumbnailsContainer && recommendations.length > 0) {
                    console.log('[JELLYFEATURED] Starting thumbnail creation for', recommendations.length, 'items');
                    // Create thumbnail items
                    const thumbnailPromises = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const rec = recommendations[i];
                        thumbnailPromises.push(createThumbnailItem(rec, i));
                    }

                    console.log('[JELLYFEATURED] Waiting for thumbnail creation...');
                    const thumbnails = await Promise.all(thumbnailPromises);
                    console.log('[JELLYFEATURED] Thumbnails created:', thumbnails.length);

                    thumbnails.forEach((thumbnail, index) => {
                        thumbnailsContainer.appendChild(thumbnail);

                        if (index === 0) {
                            thumbnail.classList.add('active');
                        }

                        // Add click handler for each thumbnail
                        thumbnail.addEventListener('click', () => {
                            goToSlide(index);
                            pauseAutoSlide();
                        });

                        thumbnail.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                goToSlide(index);
                                pauseAutoSlide();
                            }
                        });
                    });

                    // Initialize with first item
                    currentSlide = 0;
                    await createFeaturedMainItem(recommendations[0], 0);

                    // Setup navigation buttons
                    setupNavigation();

                    // Main item click handler
                    mainItem.addEventListener('click', async (e) => {
                        const title = mainItem.getAttribute('data-title');
                        const year = mainItem.getAttribute('data-year');
                        await navigateToMedia(title, year);
                    });

                    mainItem.addEventListener('keydown', async (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            const title = mainItem.getAttribute('data-title');
                            const year = mainItem.getAttribute('data-year');
                            await navigateToMedia(title, year);
                        } else if (e.key === 'ArrowLeft') {
                            e.preventDefault();
                            previousSlide();
                            pauseAutoSlide();
                        } else if (e.key === 'ArrowRight') {
                            e.preventDefault();
                            nextSlide();
                            pauseAutoSlide();
                        }
                    });

                    // Touch event handlers
                    featuredDiv.addEventListener('touchstart', handleTouchStart, { passive: true });
                    featuredDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
                    featuredDiv.addEventListener('touchend', handleTouchEnd, { passive: false });

                    mainItem.addEventListener('touchstart', handleTouchStart, { passive: true });
                    mainItem.addEventListener('touchmove', handleTouchMove, { passive: false });
                    mainItem.addEventListener('touchend', handleTouchEnd, { passive: false });

                    // Auto-slide functionality
                    setTimeout(startAutoSlide, 2000);

                    featuredDiv.addEventListener('mouseenter', pauseAutoSlide);
                    featuredDiv.addEventListener('mouseleave', () => {
                        if (!isUserInteracting) {
                            startAutoSlide();
                        }
                    });
                    console.log('[JELLYFEATURED] Setting up event handlers and injecting into page...');
                    
                } else if (mainItem) {
                    console.log('[JELLYFEATURED] Missing components or no recommendations. Main item:', !!mainItem, 'Thumbnails:', !!thumbnailsContainer, 'Recs:', recommendations.length);
                    mainItem.innerHTML = `
                        <div class="loadingSlide">
                            <p class="loadingText">Loading recommendations...</p>
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