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
    let lastSwipeTime = 0;
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

                if (item.ImageTags && item.ImageTags.Primary) {
                    const posterUrl = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}`;
                    slide.setAttribute('data-poster-url', posterUrl);
                }
                
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    const backdropUrl = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${apiKey}`;
                    slide.setAttribute('data-backdrop-url', backdropUrl);
                }

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
            // Failed to fetch item details
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

        if (index < 0 || index >= recommendations.length) return;
        if (index === currentSlide && !instanceElement) return;

        slides.forEach(slide => {
            slide.classList.remove('active');
            const posterUrl = slide.getAttribute('data-poster-url');
            if (posterUrl) {
                slide.style.background = `url("${posterUrl}")`;
                slide.style.backgroundSize = 'cover';
                slide.style.backgroundPosition = 'center';
            }
        });

        const matchingSlides = slides.filter(s => parseInt(s.getAttribute('data-index')) === index);
        if (matchingSlides.length === 0) return;

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

        (function appendOnLastActive(target) {
            try {
                const originalCount = recommendations.length || 0;
                if (!carouselContainer || originalCount === 0) return;

                if (carouselContainer.dataset.appendedForLast === 'true') return;

                if (index === originalCount - 1) {
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

        targetSlide.classList.add('active');
        const backdropUrl = targetSlide.getAttribute('data-backdrop-url');
        if (backdropUrl) {
            targetSlide.style.background = `url("${backdropUrl}")`;
            targetSlide.style.backgroundSize = 'cover';
            targetSlide.style.backgroundPosition = 'center';
        }

        dots.forEach(dot => dot.classList.remove('active'));
        const matchingDot = Array.from(dots).find(d => parseInt(d.getAttribute('data-index')) === index);
        if (matchingDot) matchingDot.classList.add('active');

        if (carouselContainer && targetSlide) {
            try {
                const containerRect = carouselContainer.getBoundingClientRect();
                const slideRect = targetSlide.getBoundingClientRect();
                const computed = getComputedStyle(carouselContainer);
                const paddingLeft = parseFloat(computed.paddingLeft) || 0;

                const delta = slideRect.left - containerRect.left;
                const targetLeft = Math.max(0, Math.round(carouselContainer.scrollLeft + delta - paddingLeft));

                carouselContainer.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } catch (e) {
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

    // Unified pointer-based swipe handlers for more consistent mobile UX
    function initPointerSwipeHandlers(rootEl) {
        if (!rootEl) return;

        let activePointerId = null;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerStartTime = 0;

        function onPointerDown(e) {
            if (e.pointerType === 'mouse') return;
            const featuredDiv = document.getElementById('jellyfeatured_div');
            if (!featuredDiv || !featuredDiv.contains(e.target)) return;

            activePointerId = e.pointerId;
            try { e.target.setPointerCapture(activePointerId); } catch (er) {}

            pointerStartX = e.clientX;
            pointerStartY = e.clientY;
            pointerStartTime = Date.now();
            isSwiping = false;
            pauseAutoSlide();
        }

        function onPointerMove(e) {
            if (activePointerId !== e.pointerId) return;
            const dx = e.clientX - pointerStartX;
            const dy = e.clientY - pointerStartY;

            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                isSwiping = true;
                try { e.preventDefault(); } catch (er) {}
            }
        }

        function onPointerUp(e) {
            if (activePointerId !== e.pointerId) return;
            try { e.target.releasePointerCapture(activePointerId); } catch (er) {}

            const dx = e.clientX - pointerStartX;
            const dy = e.clientY - pointerStartY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            if (absDx > minSwipeDistance && absDy < maxVerticalSwipe) {
                // Left swipe -> next, Right swipe -> previous
                if (dx < 0) {
                    nextSlide();
                } else {
                    previousSlide();
                }
                lastSwipeTime = Date.now();
                pauseAutoSlide();
            }

            // reset
            activePointerId = null;
            isSwiping = false;
        }

        rootEl.addEventListener('pointerdown', onPointerDown, { passive: true });
        rootEl.addEventListener('pointermove', onPointerMove, { passive: false });
        rootEl.addEventListener('pointerup', onPointerUp, { passive: true });
        rootEl.addEventListener('pointercancel', onPointerUp, { passive: true });
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
        // Prevent duplicate/concurrent injections
        if (document.getElementById('jellyfeatured_div') || document.body.dataset.jellyfeaturedInserting === 'true') return;

        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }

        const targetContainer = document.querySelector('.homePage');
        if (!targetContainer) return;

        // Mark that an insertion is in progress so parallel calls bail out
        document.body.dataset.jellyfeaturedInserting = 'true';

        try {
            // Add a blocking overlay so users can't interact with the page
            // while the featured carousel is being created and injected.
            try {
                const blocker = document.createElement('div');
                blocker.id = 'jellyfeatured_blocker';
                blocker.setAttribute('aria-hidden', 'true');
                blocker.setAttribute('role', 'presentation');
                Object.assign(blocker.style, {
                    position: 'fixed',
                    inset: '0',
                    zIndex: '2147483646',
                    background: 'transparent',
                    cursor: 'wait',
                    touchAction: 'none'
                });
                document.body.appendChild(blocker);
            } catch (e) {
                // ignore overlay failures
            }

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
                            const backdropUrl = slide.getAttribute('data-backdrop-url');
                            if (backdropUrl) {
                                slide.style.background = `url("${backdropUrl}")`;
                                slide.style.backgroundSize = 'cover';
                                slide.style.backgroundPosition = 'center';
                            }
                        }
                    });

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
                        // Ignore clicks immediately after a swipe to avoid accidental navigation
                        if (Date.now() - lastSwipeTime < 350) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }

                        let clickedSlide = e.target.closest('.featuredItem');

                        if (clickedSlide) {
                            const clickedIndex = parseInt(clickedSlide.getAttribute('data-index'));
                            const activeSlide = carouselContainer.querySelector('.featuredItem.active');

                            if (activeSlide !== clickedSlide) {
                                goToSlide(clickedIndex, { instance: clickedSlide });
                                pauseAutoSlide();
                            } else {
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

                    // Use pointer-based swipe handlers for better mobile consistency
                    try { initPointerSwipeHandlers(featuredDiv); } catch (e) {}
                    try { initPointerSwipeHandlers(carouselContainer); } catch (e) {}

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

                // Remove the blocking overlay now that the featured content is inserted
                try {
                    const bl = document.getElementById('jellyfeatured_blocker');
                    if (bl) bl.remove();
                } catch (e) {}
            }
        } finally {
            try { delete document.body.dataset.jellyfeaturedInserting; } catch (e) { document.body.removeAttribute('data-jellyfeatured-inserting'); }
            try { const bl = document.getElementById('jellyfeatured_blocker'); if (bl) bl.remove(); } catch (e) {}
        }
    }

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
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInitialize, 100));
    } else {
        setTimeout(tryInitialize, 100);
    }

    const observer = new MutationObserver(() => {
        setTimeout(() => createFeaturedCarousel(), 500);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            initAttempts = 0;
            setTimeout(() => tryInitialize(), 200);
        }
    }, 1000);
})();