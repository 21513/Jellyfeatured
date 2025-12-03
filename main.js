// Jellyfeatured Auto-Injector with Carousel Slideshow
console.log('🎬 Jellyfeatured: Auto-injector loaded');

const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

(function() {
    let currentSlide = 0;
    let autoSlideInterval;
    let isUserInteracting = false;
    
    function getJellyfinApiKey() {
        // Try to get API key from localStorage or other common locations
        try {
            const authData = localStorage.getItem('jellyfin_credentials');
            if (authData) {
                const parsed = JSON.parse(authData);
                return parsed.AccessToken || parsed.accessToken;
            }
        } catch (e) {
            console.log('Could not retrieve API key:', e);
        }
        return null;
    }
    
    function getBackdropImageUrl(title, year) {
        // Create backdrop URL for Jellyfin images
        // This uses Jellyfin's search API to find the item and get its backdrop
        const baseUrl = window.location.origin;
        const apiKey = getJellyfinApiKey();
        
        if (!apiKey) {
            // Fallback to a gradient if no API key
            return `linear-gradient(135deg, 
                var(--darkerGradientPoint, #111827), 
                var(--lighterGradientPoint, #1d2635))`;
        }
        
        // For now, use a placeholder approach since we need item IDs for proper backdrop URLs
        // In a real implementation, you'd search for the item first to get its ID
        return `linear-gradient(135deg, 
            rgba(0,0,0,0.7), 
            transparent), 
            linear-gradient(45deg, 
            var(--darkerGradientPoint, #111827), 
            var(--lighterGradientPoint, #1d2635))`;
    }
    
    function createCarouselSlide(recommendation, index) {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        slide.style.background = getBackdropImageUrl(recommendation.title, recommendation.year);
        slide.setAttribute('data-index', index);
        slide.setAttribute('tabindex', '0');
        slide.setAttribute('role', 'button');
        slide.setAttribute('aria-label', `View ${recommendation.title}`);
        
        slide.innerHTML = `
            <div class="slide-content">
                <div class="slide-title">${recommendation.title} ${recommendation.year ? '(' + recommendation.year + ')' : ''}</div>
                <div class="slide-subtitle">${recommendation.type}</div>
                <div class="slide-rating">⭐ ${recommendation.rating}</div>
            </div>
        `;
        
        // Add click handler to navigate to media
        slide.addEventListener('click', () => {
            navigateToMedia(recommendation.title, recommendation.year);
        });
        
        // Add keyboard support
        slide.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigateToMedia(recommendation.title, recommendation.year);
            }
        });
        
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
        
        // Remove active class from all slides and dots
        slides.forEach(slide => slide.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));
        
        // Add active class to current slide and dot
        if (slides[index]) {
            slides[index].classList.add('active');
            slides[index].classList.add('entering');
            setTimeout(() => slides[index].classList.remove('entering'), 500);
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
            autoSlideInterval = setInterval(() => {
                if (!isUserInteracting) {
                    nextSlide();
                }
            }, 5000); // Change slide every 5 seconds
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
    
    function createFeaturedCarousel() {
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
                    
                    // Create slides
                    recommendations.forEach((rec, index) => {
                        const slide = createCarouselSlide(rec, index);
                        carouselContainer.appendChild(slide);
                        
                        // Create navigation dot
                        const dot = createNavigationDot(index);
                        dotsContainer.appendChild(dot);
                    });
                    
                    // Show first slide
                    goToSlide(0);
                    
                    // Start auto-slide
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
                console.log('✅ Jellyfeatured: Successfully injected carousel!');
            }
        }
    }
    
    // Multiple injection attempts
    createFeaturedCarousel();
    setTimeout(createFeaturedCarousel, 500);
    setTimeout(createFeaturedCarousel, 1000);
    setTimeout(createFeaturedCarousel, 2000);
    
    // Watch for navigation changes
    const observer = new MutationObserver(() => setTimeout(createFeaturedCarousel, 300));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    // URL change detection
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(createFeaturedCarousel, 200);
        }
    }, 1000);
})();