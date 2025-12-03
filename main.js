const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

(function() {
    let currentSlide = 0;
    let autoSlideInterval;
    let isUserInteracting = false;
    let injectionInProgress = false;
    let injectionComplete = false;
    let apiCallCount = 0;
    let lastApiCall = 0;
    
    function getJellyfinApiKey() {
        // Try to get API key from multiple locations
        try {
            // Check for API client instance
            if (window.ApiClient && window.ApiClient.accessToken) {
                return window.ApiClient.accessToken();
            }
            
            // Check for credentials in localStorage
            const authData = localStorage.getItem('jellyfin_credentials');
            if (authData) {
                const parsed = JSON.parse(authData);
                if (parsed.Servers && parsed.Servers.length > 0) {
                    return parsed.Servers[0].AccessToken;
                }
                return parsed.AccessToken || parsed.accessToken;
            }
        } catch (e) {
            console.log('Could not retrieve API key:', e);
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
        
        // Rate limiting to prevent API flooding
        const now = Date.now();
        if (now - lastApiCall < 100) { // Very short delay to prevent simultaneous calls
            console.log('🎬 Jellyfeatured: API rate limited, skipping call');
            return null;
        }
        
        if (apiCallCount > 50) { // Higher limit for more slides
            console.log('🎬 Jellyfeatured: API call limit reached, skipping call');
            return null;
        }
        
        // Avoid API calls during active media playback to prevent interference
        if (document.querySelector('.videoPlayerContainer.active') ||
            document.querySelector('video[src]') ||
            document.querySelector('audio[src]') ||
            document.querySelector('[data-playing="true"]') ||
            window.currentlyPlaying) {
            console.log('🎬 Jellyfeatured: Media playback active, skipping API call');
            return null;
        }

        try {
            lastApiCall = now;
            apiCallCount++;
            
            const searchUrl = `${baseUrl}/Items?searchTerm=${encodeURIComponent(title)}&Recursive=true&Fields=PrimaryImageAspectRatio,BackdropImageTags,ImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo&Limit=5&api_key=${apiKey}`;
            
            // Use a shorter timeout to avoid blocking
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const response = await fetch(searchUrl, { 
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'max-age=300' // Cache for 5 minutes
                }
            });
            
            clearTimeout(timeoutId);
            
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
            if (e.name === 'AbortError') {
                console.log('🎬 Jellyfeatured: API call timed out for', title);
            } else {
                console.log(`🎬 Jellyfeatured: API call failed for ${title}:`, e.message);
            }
        }
        
        return null;
    }    function getBackdropImageUrl(title, year) {
        // Return a promise that resolves to the backdrop URL
        return searchForItem(title, year).then(item => {
            if (item && item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                return `url("${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}")`;
            } else {
                // Fallback gradient with better colors
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
            // Fallback gradient
            return `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        });
    }
    
    async function createCarouselSlide(recommendation, index) {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        slide.setAttribute('data-index', index);
        slide.setAttribute('data-title', recommendation.title);
        slide.setAttribute('data-year', recommendation.year || '');
        slide.setAttribute('tabindex', '0');
        slide.setAttribute('role', 'button');
        slide.setAttribute('aria-label', `View ${recommendation.title}`);
        
        // Set initial gradient while loading
        slide.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        
        // Create slide content structure with logo placeholder
        slide.innerHTML = `
            <div class="slide-content">
                <div class="slide-logo-container">
                    <img class="slide-logo" style="display: none;" alt="${recommendation.title} logo" />
                </div>
                <div class="slide-text-content">
                    <div class="slide-title">${recommendation.title} ${recommendation.year ? '(' + recommendation.year + ')' : ''}</div>
                    <div class="slide-subtitle">${recommendation.type}</div>
                    <div class="slide-rating">⭐ ${recommendation.rating}</div>
                </div>
            </div>
        `;
        
        // Load media item data and images asynchronously
        try {
            const item = await searchForItem(recommendation.title, recommendation.year);
            
            if (item) {
                // Set backdrop image
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const backdropUrl = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}`;
                    slide.style.background = `url("${backdropUrl}")`;
                    slide.style.backgroundSize = 'cover';
                    slide.style.backgroundPosition = 'center';
                    slide.style.backgroundRepeat = 'no-repeat';
                }
                
                // Set logo image if available
                if (item.ImageTags && item.ImageTags.Logo) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const logoUrl = `${baseUrl}/Items/${item.Id}/Images/Logo?api_key=${apiKey}`;
                    const logoImg = slide.querySelector('.slide-logo');
                    logoImg.src = logoUrl;
                    logoImg.style.display = 'block';
                }
            }
        } catch (e) {
            console.log('Failed to load images for', recommendation.title, e);
            // Fallback to colorful gradient
            const colors = [
                'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 
                'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
            ];
            const hash = recommendation.title.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
            slide.style.background = colors[Math.abs(hash) % colors.length];
        }
        
        return slide;
    }
    
    function createNavigationDot(index) {
        const dot = document.createElement('div');
        dot.className = 'carousel-dot';
        dot.setAttribute('data-index', index);
        dot.setAttribute('tabindex', '0');
        dot.setAttribute('role', 'button');
        dot.setAttribute('aria-label', `Go to slide ${index + 1}`);
        
        dot.addEventListener('click', () => {
            goToSlide(index);
            pauseAutoSlide();
        });
        
        dot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                goToSlide(index);
                pauseAutoSlide();
            }
        });
        
        return dot;
    }
    
    function goToSlide(index) {
        const carouselContainer = document.querySelector('#recommendations-carousel');
        if (!carouselContainer) return;
        
        const slides = carouselContainer.querySelectorAll('.carousel-slide');
        const dots = document.querySelectorAll('#carousel-dots .carousel-dot');
        
        if (slides.length === 0 || index >= slides.length) return;
        
        // Don't return early if index === currentSlide, allow re-activation
        console.log(`🎬 Jellyfeatured: Going to slide ${index}, current: ${currentSlide}`);
        
        // Remove active and entering classes from all slides and dots
        slides.forEach((slide, i) => {
            slide.classList.remove('active', 'entering');
        });
        dots.forEach(dot => dot.classList.remove('active'));
        
        // Add active class to current slide and dot with smoother transition
        if (slides[index]) {
            slides[index].classList.add('active');
            console.log(`✅ Jellyfeatured: Activated slide ${index}`);
        }
        
        if (dots[index]) {
            dots[index].classList.add('active');
        }
        
        currentSlide = index;
    }
    
    function nextSlide() {
        const nextIndex = (currentSlide + 1) % recommendations.length;
        console.log(`🎬 Jellyfeatured: Auto-advancing from slide ${currentSlide} to ${nextIndex}`);
        goToSlide(nextIndex);
    }
    
    function startAutoSlide() {
        if (recommendations.length > 1) {
            clearInterval(autoSlideInterval); // Clear any existing interval
            console.log('🎬 Jellyfeatured: Starting auto-slide timer');
            autoSlideInterval = setInterval(() => {
                if (!isUserInteracting) {
                    nextSlide();
                }
            }, 6000); // Change slide every 6 seconds for better viewing
        }
    }
    
    function pauseAutoSlide() {
        isUserInteracting = true;
        clearInterval(autoSlideInterval);
        
        // Resume auto-slide after 10 seconds of no interaction
        setTimeout(() => {
            isUserInteracting = false;
            startAutoSlide();
        }, 10000);
    }
    
    async function navigateToMedia(title, year) {
        console.log(`🎬 Navigating to: ${title} ${year ? '(' + year + ')' : ''}`);
        
        // Extra safety check before navigation
        try {
            // Search for the item to get its ID
            const item = await searchForItem(title, year);
            if (item && item.Id) {
                // Use Jellyfin's built-in navigation if available
                if (window.Emby && window.Emby.Page && window.Emby.Page.show) {
                    window.Emby.Page.show(`/details?id=${item.Id}`);
                    return;
                } else if (window.Dashboard && window.Dashboard.navigate) {
                    window.Dashboard.navigate(`details?id=${item.Id}`);
                    return;
                } else {
                    // Fallback to direct navigation
                    const detailUrl = `${window.location.origin}/web/index.html#!/details?id=${item.Id}`;
                    window.location.href = detailUrl;
                    return;
                }
            }
        } catch (e) {
            console.log('Failed to find item for navigation:', e);
        }
        
        // Fallback to search if we can't find the specific item
        const searchQuery = encodeURIComponent(title);
        const searchUrl = `${window.location.origin}/web/index.html#!/search.html?query=${searchQuery}`;
        window.location.href = searchUrl;
    }
    
    async function createFeaturedCarousel() {
        // Enhanced duplicate prevention
        if (document.getElementById('jellyfeatured-div')) {
            console.log('🎬 Jellyfeatured: Already exists, skipping injection');
            return;
        }
        
        if (injectionInProgress) {
            console.log('🎬 Jellyfeatured: Injection already in progress, skipping');
            return;
        }
        
        if (injectionComplete) {
            console.log('🎬 Jellyfeatured: Injection already completed for this session, skipping');
            return;
        }
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        console.log('🎬 Jellyfeatured: Starting carousel injection...');
        injectionInProgress = true;
        
        try {
            const targetContainer = document.querySelector('.homePage');
            if (targetContainer) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlTemplate;
            const featuredDiv = tempDiv.firstElementChild;
            
            if (featuredDiv) {
                const carouselContainer = featuredDiv.querySelector('#recommendations-carousel');
                const dotsContainer = featuredDiv.querySelector('#carousel-dots');
                
                if (carouselContainer && recommendations.length > 0) {
                    // Remove loading slide
                    const loadingSlide = carouselContainer.querySelector('.loading-slide');
                    if (loadingSlide) {
                        loadingSlide.remove();
                    }
                    
                    // Create slides asynchronously and wait for all to be ready
                    const slidePromises = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const rec = recommendations[i];
                        slidePromises.push(createCarouselSlide(rec, i));
                    }
                    
                    // Wait for all slides to be created
                    const slides = await Promise.all(slidePromises);
                    console.log(`🎬 Jellyfeatured: Created ${slides.length} slides for ${recommendations.length} recommendations`);
                    
                    // Add all slides and dots to DOM and show first slide immediately
                    slides.forEach((slide, index) => {
                        carouselContainer.appendChild(slide);
                        const dot = createNavigationDot(index);
                        dotsContainer.appendChild(dot);
                        
                        console.log(`🎬 Jellyfeatured: Added slide ${index} to DOM`);
                        
                        // Make first slide visible immediately
                        if (index === 0) {
                            slide.classList.add('active');
                            dot.classList.add('active');
                            console.log(`✅ Jellyfeatured: Set slide 0 as active`);
                        }
                    });
                    
                    // Set current slide to 0
                    currentSlide = 0;
                    
                    // Add centralized click handler for the carousel container
                    carouselContainer.addEventListener('click', async (e) => {
                        // Only handle clicks on active slides
                        const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                        if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                            const title = activeSlide.getAttribute('data-title');
                            const year = activeSlide.getAttribute('data-year');
                            await navigateToMedia(title, year);
                        }
                    });
                    
                    // Add keyboard support for carousel
                    carouselContainer.addEventListener('keydown', async (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                            if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                                e.preventDefault();
                                const title = activeSlide.getAttribute('data-title');
                                const year = activeSlide.getAttribute('data-year');
                                await navigateToMedia(title, year);
                            }
                        }
                    });
                    
                    // Start auto-slide after a short delay
                    setTimeout(startAutoSlide, 2000); // Start after 2 seconds
                    
                    // Pause auto-slide on hover
                    featuredDiv.addEventListener('mouseenter', pauseAutoSlide);
                    featuredDiv.addEventListener('mouseleave', () => {
                        if (!isUserInteracting) {
                            startAutoSlide();
                        }
                    });
                    
                } else if (carouselContainer) {
                    // Show loading state
                    carouselContainer.innerHTML = `
                        <div class="loading-slide">
                            <p class="loading-text">Loading recommendations...</p>
                        </div>
                    `;
                }
                
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
                injectionComplete = true;
                injectionInProgress = false;
                console.log('✅ Jellyfeatured: Successfully injected carousel!');
            }
            } else {
                injectionInProgress = false;
                console.log('⚠️ Jellyfeatured: Target container (.homePage) not found');
            }
        } catch (error) {
            injectionInProgress = false;
            console.error('❌ Jellyfeatured: Injection failed:', error);
        }
    }
    
    // Multiple injection attempts with better control
    createFeaturedCarousel();
    setTimeout(() => {
        if (!injectionComplete) createFeaturedCarousel();
    }, 500);
    setTimeout(() => {
        if (!injectionComplete) createFeaturedCarousel();
    }, 1000);
    setTimeout(() => {
        if (!injectionComplete) createFeaturedCarousel();
    }, 2000);
    
    // Watch for navigation changes with better detection
    const observer = new MutationObserver((mutations) => {
        // Only react to significant DOM changes
        const hasSignificantChanges = mutations.some(mutation => 
            mutation.type === 'childList' && 
            mutation.addedNodes.length > 0 &&
            Array.from(mutation.addedNodes).some(node => 
                node.nodeType === 1 && // Element node
                (node.classList?.contains('homePage') || 
                 node.querySelector?.('.homePage'))
            )
        );
        
        if (hasSignificantChanges && !injectionComplete) {
            setTimeout(() => createFeaturedCarousel(), 300);
        }
    });
    
    if (document.body) {
        observer.observe(document.body, { 
            childList: true, 
            subtree: true
        });
    }
    
    // URL change detection with reset for new pages
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            // Reset injection state for new page navigation
            if (!location.href.includes('home') && 
                location.pathname !== '/' && 
                location.pathname !== '/web/' && 
                location.pathname !== '/web/index.html') {
                injectionComplete = false;
                injectionInProgress = false;
            }
            setTimeout(() => {
                if (!injectionComplete) createFeaturedCarousel();
            }, 200);
        }
    }, 1000);
})();