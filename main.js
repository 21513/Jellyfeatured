const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlTemplate = `{{HTML_TEMPLATE}}`;

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
        slide.className = 'featuredItem';
        slide.setAttribute('data-index', index);
        slide.setAttribute('data-title', recommendation.title);
        slide.setAttribute('data-year', recommendation.year || '');
        slide.setAttribute('tabindex', '0');
        slide.setAttribute('role', 'button');
        slide.setAttribute('aria-label', `View ${recommendation.title}`);

        slide.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;

        slide.innerHTML = `
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
            const item = await searchForItem(recommendation.title, recommendation.year);
            
            if (item) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                
                // Store both poster and backdrop URLs as data attributes
                if (item.ImageTags && item.ImageTags.Primary) {
                    const posterUrl = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}`;
                    slide.setAttribute('data-poster-url', posterUrl);
                }
                
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    const backdropUrl = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}`;
                    slide.setAttribute('data-backdrop-url', backdropUrl);
                }
                
                // Initially show poster (since not active by default)
                const posterUrl = slide.getAttribute('data-poster-url');
                if (posterUrl) {
                    slide.style.background = `url("${posterUrl}")`;
                    slide.style.backgroundSize = 'cover';
                    slide.style.backgroundPosition = 'center';
                    slide.style.backgroundRepeat = 'no-repeat';
                }
                
                if (item.ImageTags && item.ImageTags.Logo) {
                    const logoUrl = `${baseUrl}/Items/${item.Id}/Images/Logo?api_key=${apiKey}`;
                    const logoImg = slide.querySelector('.featuredLogo');
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
        dot.className = 'featuredDot';
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
    
    function goToSlide(index, options = {}) {
        const instanceElement = options.instance || null;
        const slides = Array.from(document.querySelectorAll('.featuredItem'));
        const dots = document.querySelectorAll('.featuredDot');
        const carouselContainer = document.getElementById('featured_items');

        if (slides.length === 0) return;

        // If requested index is out of range, ignore
        if (index < 0 || index >= recommendations.length) return;
        // If already active and no specific instance requested, ignore
        if (index === currentSlide && !instanceElement) return;

        // Deactivate all slides and switch them to poster background
        slides.forEach(slide => {
            slide.classList.remove('active');
            const posterUrl = slide.getAttribute('data-poster-url');
            if (posterUrl) {
                slide.style.background = `url("${posterUrl}")`;
                slide.style.backgroundSize = 'cover';
                slide.style.backgroundPosition = 'center';
            }
        });

        // Find all slide instances that correspond to the original data-index
        const matchingSlides = slides.filter(s => parseInt(s.getAttribute('data-index')) === index);
        if (matchingSlides.length === 0) return;

        // If a specific instance element was provided and it matches, prefer it
        let targetSlide = matchingSlides[0];
        if (instanceElement && matchingSlides.includes(instanceElement)) {
            targetSlide = instanceElement;
        } else {
            try {
                const containerRect = carouselContainer ? carouselContainer.getBoundingClientRect() : null;
                if (containerRect) {
                    let bestDelta = Infinity;
                    matchingSlides.forEach(s => {
                        const rect = s.getBoundingClientRect();
                        const delta = Math.abs(rect.left - containerRect.left);
                        if (delta < bestDelta) { bestDelta = delta; targetSlide = s; }
                    });
                }
            } catch (e) {
                targetSlide = matchingSlides[0];
            }
        }
        if (!targetSlide) return;

        // If the activated item is the last original item, append one full set of original items
        (function appendOnLastActive(target) {
            try {
                const originalCount = recommendations.length || 0;
                if (!carouselContainer || originalCount === 0) return;

                // Only append once per session to avoid unbounded growth
                if (carouselContainer.dataset.appendedForLast === 'true') return;

                // If the activated index is the last original index, append one clone set
                if (index === originalCount - 1) {
                    // Find one instance of each original index and clone them
                    for (let i = 0; i < originalCount; i++) {
                        const src = Array.from(carouselContainer.querySelectorAll('.featuredItem')).find(s => parseInt(s.getAttribute('data-index')) === i);
                        if (src) {
                            const clone = src.cloneNode(true);
                            clone.classList.remove('active', 'entering', 'exiting');
                            clone.setAttribute('data-clone', 'true');
                            carouselContainer.appendChild(clone);
                        }
                    }
                    carouselContainer.dataset.appendedForLast = 'true';
                }
            } catch (e) {
                // ignore
            }
        })(targetSlide);

        // Activate target and switch to backdrop if available
        targetSlide.classList.add('active');
        const backdropUrl = targetSlide.getAttribute('data-backdrop-url');
        if (backdropUrl) {
            targetSlide.style.background = `url("${backdropUrl}")`;
            targetSlide.style.backgroundSize = 'cover';
            targetSlide.style.backgroundPosition = 'center';
        }

        // Update dots (dots correspond to original indices)
        dots.forEach(dot => dot.classList.remove('active'));
        const matchingDot = Array.from(dots).find(d => parseInt(d.getAttribute('data-index')) === index);
        if (matchingDot) matchingDot.classList.add('active');

        // Scroll the carousel so the activated slide becomes the first visible item
        if (carouselContainer && targetSlide) {
            try {
                const containerRect = carouselContainer.getBoundingClientRect();
                const slideRect = targetSlide.getBoundingClientRect();
                const computed = getComputedStyle(carouselContainer);
                const paddingLeft = parseFloat(computed.paddingLeft) || 0;

                // Calculate the left offset within the scrollable content
                const delta = slideRect.left - containerRect.left;
                const targetLeft = Math.max(0, Math.round(carouselContainer.scrollLeft + delta - paddingLeft));

                carouselContainer.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } catch (e) {
                // Fallback
                try { targetSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); } catch (er) {}
            }
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
        const featuredDiv = document.getElementById('jellyfeatured_div');
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
        
        const featuredDiv = document.getElementById('jellyfeatured_div');
        if (!featuredDiv || !featuredDiv.contains(e.target)) {
            return;
        }
        
        const touch = e.touches[0] || e.changedTouches[0];
        endX = touch.clientX;
        endY = touch.clientY;
        
        const deltaX = Math.abs(startX - endX);
        const deltaY = Math.abs(startY - endY);

        if (deltaX > 10) {
            e.preventDefault();
            e.stopPropagation();
            isSwiping = true;
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
        
        if (isSwiping) {
            e.preventDefault();
            e.stopPropagation();
            
            const deltaX = startX - endX;
            const deltaY = Math.abs(startY - endY);

            if (Math.abs(deltaX) > minSwipeDistance && deltaY < maxVerticalSwipe) {
                if (deltaX > 0) {
                    nextSlide();
                } else {
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
        if (document.getElementById('jellyfeatured_div')) return;
        
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
                const carouselContainer = featuredDiv.querySelector('#featured_items');
                const dotsContainer = featuredDiv.querySelector('#featuredDots');
                
                if (carouselContainer && recommendations.length > 0) {
                    const loadingSlide = carouselContainer.querySelector('.loadingSlide');
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

                        if (index === 0) {
                            slide.classList.add('active');
                            // Switch first item to backdrop
                            const backdropUrl = slide.getAttribute('data-backdrop-url');
                            if (backdropUrl) {
                                slide.style.background = `url("${backdropUrl}")`;
                                slide.style.backgroundSize = 'cover';
                                slide.style.backgroundPosition = 'center';
                            }
                        }
                    });

                    // Append one cloned set to the right so there's at least one extra cycle
                    // Guard with a data flag so this only runs once per page load
                    if (!carouselContainer.dataset.initialCloned) {
                        slides.forEach((origSlide) => {
                            const clone = origSlide.cloneNode(true);
                            clone.classList.remove('active', 'entering', 'exiting');
                            clone.setAttribute('data-clone', 'initial');
                            carouselContainer.appendChild(clone);
                        });
                        carouselContainer.dataset.initialCloned = 'true';
                    }

                    currentSlide = 0;

                    carouselContainer.addEventListener('click', async (e) => {
                        // Find which item was clicked
                        let clickedSlide = e.target.closest('.featuredItem');
                        
                        if (clickedSlide) {
                            // Use the original data-index so ordering changes don't affect behavior
                            const clickedIndex = parseInt(clickedSlide.getAttribute('data-index'));
                            const activeSlide = carouselContainer.querySelector('.featuredItem.active');
                            
                            // If clicking a different instance (clone) of the same item, force activation of that instance
                            if (activeSlide !== clickedSlide) {
                                goToSlide(clickedIndex, { instance: clickedSlide });
                                pauseAutoSlide();
                            } else {
                                // If clicking the active item instance, navigate to it
                                const title = clickedSlide.getAttribute('data-title');
                                const year = clickedSlide.getAttribute('data-year');
                                await navigateToMedia(title, year);
                            }
                        }
                    });

                    carouselContainer.addEventListener('keydown', async (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            const activeSlide = carouselContainer.querySelector('.featuredItem.active');
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

                    featuredDiv.addEventListener('touchstart', handleTouchStart, { passive: true });
                    featuredDiv.addEventListener('touchmove', handleTouchMove, { passive: false });
                    featuredDiv.addEventListener('touchend', handleTouchEnd, { passive: false });

                    carouselContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
                    carouselContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
                    carouselContainer.addEventListener('touchend', handleTouchEnd, { passive: false });

                    setTimeout(startAutoSlide, 2000);

                    featuredDiv.addEventListener('mouseenter', pauseAutoSlide);
                    featuredDiv.addEventListener('mouseleave', () => {
                        if (!isUserInteracting) {
                            startAutoSlide();
                        }
                    });
                    
                } else if (carouselContainer) {
                    carouselContainer.innerHTML = `
                        <div class="loadingSlide">
                            <p class="loadingText">Loading recommendations...</p>
                        </div>
                    `;
                }
                
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            }
    }

    // Initialize with retry mechanism
    let initAttempts = 0;
    const maxInitAttempts = 10;
    
    function tryInitialize() {
        const targetContainer = document.querySelector('.homePage');
        if (targetContainer && !document.getElementById('jellyfeatured_div')) {
            createFeaturedCarousel();
        } else if (initAttempts < maxInitAttempts) {
            initAttempts++;
            setTimeout(tryInitialize, 500);
        }
    }
    
    // Try immediately if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInitialize, 100));
    } else {
        setTimeout(tryInitialize, 100);
    }

    // Watch for DOM changes
    const observer = new MutationObserver(() => {
        setTimeout(() => createFeaturedCarousel(), 500);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    // Watch for URL changes (navigation)
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            initAttempts = 0; // Reset attempts on navigation
            setTimeout(() => tryInitialize(), 200);
        }
    }, 1000);
})();