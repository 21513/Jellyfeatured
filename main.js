const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

(function() {
    let currentSlide = 0;
    let autoSlideInterval;
    let isUserInteracting = false;
    
    // Touch/Swipe support variables
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
    
    async function createCarouselSlide(recommendation, index) {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        slide.setAttribute('data-index', index);
        slide.setAttribute('data-title', recommendation.title);
        slide.setAttribute('data-year', recommendation.year || '');
        slide.setAttribute('tabindex', '0');
        slide.setAttribute('role', 'button');
        slide.setAttribute('aria-label', `View ${recommendation.title}`);

        slide.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

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

        try {
            const item = await searchForItem(recommendation.title, recommendation.year);
            
            if (item) {
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    const apiKey = getJellyfinApiKey();
                    const baseUrl = getJellyfinBaseUrl();
                    const backdropUrl = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}`;
                    slide.style.background = `url("${backdropUrl}")`;
                    slide.style.backgroundSize = 'cover';
                    slide.style.backgroundPosition = 'center';
                    slide.style.backgroundRepeat = 'no-repeat';
                }
                
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
        const slides = document.querySelectorAll('.carousel-slide');
        const dots = document.querySelectorAll('.carousel-dot');
        
        if (slides.length === 0 || index >= slides.length || index === currentSlide) return;
        
        slides.forEach((slide, i) => {
            if (i !== index) {
                slide.classList.remove('active', 'entering');
            }
        });
        dots.forEach(dot => dot.classList.remove('active'));

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
    
    function previousSlide() {
        const prevIndex = (currentSlide - 1 + recommendations.length) % recommendations.length;
        goToSlide(prevIndex);
    }

    function handleTouchStart(e) {
        // Only handle touch if it starts within the featured div
        const featuredDiv = document.getElementById('jellyfeatured-div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            return;
        }
        
        const touch = e.touches[0] || e.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        isSwiping = false;
        pauseAutoSlide();
    }
    
    function handleTouchMove(e) {
        if (!startX || !startY) return;
        
        // Only prevent default if we're swiping on the featured div
        const featuredDiv = document.getElementById('jellyfeatured-div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            return;
        }
        
        const touch = e.touches[0] || e.changedTouches[0];
        endX = touch.clientX;
        endY = touch.clientY;
        
        const deltaX = Math.abs(startX - endX);
        const deltaY = Math.abs(startY - endY);

        if (deltaX > deltaY && deltaX > 10) {
            e.preventDefault();
            isSwiping = true;
        }
    }
    
    function handleTouchEnd(e) {
        if (!startX || !startY || !isSwiping) {
            return;
        }
        
        // Only process touch if it's within the featured div
        const featuredDiv = document.getElementById('jellyfeatured-div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            // Reset values and return
            startX = 0;
            startY = 0;
            endX = 0;
            endY = 0;
            isSwiping = false;
            return;
        }
        
        const deltaX = startX - endX;
        const deltaY = Math.abs(startY - endY);

        if (Math.abs(deltaX) > minSwipeDistance && deltaY < maxVerticalSwipe) {
            if (deltaX > 0) {
                nextSlide();
            } else {
                previousSlide();
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
        if (document.getElementById('jellyfeatured-div')) return;
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        const targetContainer = document.querySelector('.homePage');
        if (!targetContainer) return;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlTemplate;
        const featuredDiv = tempDiv.firstElementChild;
            
            if (featuredDiv) {
                const carouselContainer = featuredDiv.querySelector('#recommendations-carousel');
                const dotsContainer = featuredDiv.querySelector('#carousel-dots');
                
                if (carouselContainer && recommendations.length > 0) {
                    const loadingSlide = carouselContainer.querySelector('.loading-slide');
                    if (loadingSlide) {
                        loadingSlide.remove();
                    }
                    
                    const slidePromises = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const rec = recommendations[i];
                        slidePromises.push(createCarouselSlide(rec, i));
                    }

                    const slides = await Promise.all(slidePromises);

                    slides.forEach((slide, index) => {
                        carouselContainer.appendChild(slide);
                        const dot = createNavigationDot(index);
                        dotsContainer.appendChild(dot);

                        if (index === 0) {
                            slide.classList.add('active');
                            dot.classList.add('active');
                        }
                    });

                    currentSlide = 0;

                    carouselContainer.addEventListener('click', async (e) => {
                        const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                        if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                            const title = activeSlide.getAttribute('data-title');
                            const year = activeSlide.getAttribute('data-year');
                            await navigateToMedia(title, year);
                        }
                    });

                    carouselContainer.addEventListener('keydown', async (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            const activeSlide = carouselContainer.querySelector('.carousel-slide.active');
                            if (activeSlide && (e.target === activeSlide || activeSlide.contains(e.target))) {
                                e.preventDefault();
                                const title = activeSlide.getAttribute('data-title');
                                const year = activeSlide.getAttribute('data-year');
                                await navigateToMedia(title, year);
                            }
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
                    
                    carouselContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
                    carouselContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
                    carouselContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

                    setTimeout(startAutoSlide, 2000);

                    featuredDiv.addEventListener('mouseenter', pauseAutoSlide);
                    featuredDiv.addEventListener('mouseleave', () => {
                        if (!isUserInteracting) {
                            startAutoSlide();
                        }
                    });
                    
                } else if (carouselContainer) {
                    carouselContainer.innerHTML = `
                        <div class="loading-slide">
                            <p class="loading-text">Loading recommendations...</p>
                        </div>
                    `;
                }
                
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            }
    }

    if (!document.getElementById('jellyfeatured-div')) {
        createFeaturedCarousel();        
        setTimeout(() => createFeaturedCarousel(), 1000);
    }

    const observer = new MutationObserver(() => setTimeout(() => createFeaturedCarousel(), 500));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(() => createFeaturedCarousel(), 200);
        }
    }, 1000);
})();