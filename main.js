// Jellyfeatured Auto-Injector with Carousel Slideshow
console.log('🎬 Jellyfeatured: Auto-injector loaded');

const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

(function() {
    let currentSlide = 0;
    let autoSlideInterval;
    let isUserInteracting = false;
    
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
        
        try {
            const searchUrl = `${baseUrl}/Items?searchTerm=${encodeURIComponent(title)}&Recursive=true&Fields=PrimaryImageAspectRatio,BackdropImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop&Limit=5&api_key=${apiKey}`;
            
            const response = await fetch(searchUrl);
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }
            
            const data = await response.json();
            if (data.Items && data.Items.length > 0) {
                // Find exact match or closest match by year
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
            console.log(`Failed to search for ${title}:`, e);
        }
        
        return null;
    }
    
    function getBackdropImageUrl(title, year) {
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
        
        slide.innerHTML = `
            <div class="slide-content">
                <div class="slide-title">${recommendation.title} ${recommendation.year ? '(' + recommendation.year + ')' : ''}</div>
                <div class="slide-subtitle">${recommendation.type}</div>
                <div class="slide-rating">⭐ ${recommendation.rating}</div>
            </div>
        `;
        
        // Load backdrop image asynchronously
        try {
            const backgroundValue = await getBackdropImageUrl(recommendation.title, recommendation.year);
            slide.style.background = backgroundValue;
            slide.style.backgroundSize = 'cover';
            slide.style.backgroundPosition = 'center';
            slide.style.backgroundRepeat = 'no-repeat';
        } catch (e) {
            console.log('Failed to load backdrop for', recommendation.title, e);
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
        const slides = document.querySelectorAll('.carousel-slide');
        const dots = document.querySelectorAll('.carousel-dot');
        
        if (slides.length === 0 || index >= slides.length || index === currentSlide) return;
        
        // Remove active and entering classes from all slides and dots
        slides.forEach((slide, i) => {
            if (i !== index) {
                slide.classList.remove('active', 'entering');
            }
        });
        dots.forEach(dot => dot.classList.remove('active'));
        
        // Add active class to current slide and dot with smoother transition
        if (slides[index]) {
            slides[index].classList.add('active');
        }
        
        if (dots[index]) {
            dots[index].classList.add('active');
        }
        
        currentSlide = index;
    }
    
    function nextSlide() {
        const nextIndex = (currentSlide + 1) % recommendations.length;
        goToSlide(nextIndex);
    }
    
    function startAutoSlide() {
        if (recommendations.length > 1) {
            clearInterval(autoSlideInterval); // Clear any existing interval
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
    
    function navigateToMedia(title, year) {
        // This would ideally use Jellyfin's search to find and navigate to the media
        // For now, we'll try a basic search approach
        console.log(`🎬 Navigating to: ${title} ${year ? '(' + year + ')' : ''}`);
        
        // Try to trigger Jellyfin's search
        const searchQuery = encodeURIComponent(title);
        const searchUrl = `${window.location.origin}/web/index.html#!/search.html?query=${searchQuery}`;
        window.location.href = searchUrl;
    }
    
    async function createFeaturedCarousel() {
        if (document.getElementById('jellyfeatured-div')) return;
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        console.log('🎬 Jellyfeatured: Attempting carousel injection...');
        
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
                    
                    // Add all slides and dots to DOM
                    slides.forEach((slide, index) => {
                        carouselContainer.appendChild(slide);
                        const dot = createNavigationDot(index);
                        dotsContainer.appendChild(dot);
                    });
                    
                    // Add centralized click handler for the carousel container
                    carouselContainer.addEventListener('click', (e) => {
                        // Only handle clicks on active slides
                        const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                        if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                            const title = activeSlide.getAttribute('data-title');
                            const year = activeSlide.getAttribute('data-year');
                            navigateToMedia(title, year);
                        }
                    });
                    
                    // Add keyboard support for carousel
                    carouselContainer.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                            if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                                e.preventDefault();
                                const title = activeSlide.getAttribute('data-title');
                                const year = activeSlide.getAttribute('data-year');
                                navigateToMedia(title, year);
                            }
                        }
                    });
                    
                    // Wait a frame for DOM updates, then show first slide
                    requestAnimationFrame(() => {
                        goToSlide(0);
                        
                        // Start auto-slide after everything is loaded and displayed
                        setTimeout(startAutoSlide, 3000); // Start after 3 seconds
                    });
                    
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
                console.log('✅ Jellyfeatured: Successfully injected carousel!');
            }
        }
    }
    
    // Multiple injection attempts
    createFeaturedCarousel();
    setTimeout(() => createFeaturedCarousel(), 500);
    setTimeout(() => createFeaturedCarousel(), 1000);
    setTimeout(() => createFeaturedCarousel(), 2000);
    
    // Watch for navigation changes
    const observer = new MutationObserver(() => setTimeout(() => createFeaturedCarousel(), 300));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    // URL change detection
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(() => createFeaturedCarousel(), 200);
        }
    }, 1000);
})();