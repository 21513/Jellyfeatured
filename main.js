const recommendations = JSON.parse(`{{RECOMMENDATIONS_DATA_JSON}}`);
const htmlTemplate = `{{HTML_TEMPLATE}}`;

console.log('[Jellyfeatured] Script loaded. Recommendations count:', recommendations.length);

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
    let lastDragTime = 0;
    const minSwipeDistance = 50;
    const maxVerticalSwipe = 100;
    
    function getJellyfinApiKey() {
        try {
            if (window.ApiClient && window.ApiClient.accessToken) {
                const token = window.ApiClient.accessToken();
                console.log('[Jellyfeatured] ApiClient.accessToken() =>', token ? '(token present)' : '(null/empty)');
                return token;
            }
            console.log('[Jellyfeatured] window.ApiClient not available or no accessToken method, falling back to localStorage');
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
        return searchForItem(title, year).then(async item => {
            if (item && item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                const apiKey = getJellyfinApiKey();
                const baseUrl = getJellyfinBaseUrl();
                try {
                    const endpoint = `${baseUrl}/Items/${item.Id}/Images/Backdrop`;
                    // Prefer using the api_key query parameter (avoids custom header issues in embedded webviews)
                    const endpointWithKey = apiKey ? `${endpoint}?api_key=${encodeURIComponent(apiKey)}` : endpoint;
                    try {
                        const resp = await fetch(endpointWithKey);
                        if (resp.ok) {
                            const blob = await resp.blob();
                            return `url("${URL.createObjectURL(blob)}")`;
                        }
                    } catch (e) {
                        // fallthrough to return endpoint url for browser to load directly
                    }

                    return `url("${endpointWithKey}")`;
                } catch (e) {
                    return `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
                }
            }
            return null;
        }).catch(() => {
            return `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
        });
    }

    // Helper: fetch an image using token header when available and return either an object URL or the direct endpoint URL
    async function fetchImageForDisplay(itemId, imageType, apiKey, baseUrl) {
        try {
            let endpoint = `${baseUrl}/Items/${itemId}/Images/${imageType}`;
            
            // Add quality constraints to speed up loading
            const params = new URLSearchParams();
            if (apiKey) params.append('api_key', apiKey);
            
            if (imageType === 'Backdrop') {
                // Limit backdrops to 1080p (1920x1080)
                params.append('maxWidth', '1920');
                params.append('maxHeight', '1080');
                params.append('quality', '85');
            } else if (imageType === 'Primary') {
                // Limit posters to max 1500px height
                params.append('maxHeight', '1500');
                params.append('quality', '85');
            } else if (imageType === 'Logo') {
                // Limit logos to reasonable size
                params.append('maxHeight', '300');
                params.append('quality', '90');
            }
            
            const endpointWithKey = `${endpoint}?${params.toString()}`;

            // Try fetching the image via the api_key query parameter (many embedded webviews block custom headers)
            try {
                const resp = await fetch(endpointWithKey);
                if (resp.ok) {
                    const blob = await resp.blob();
                    return URL.createObjectURL(blob);
                }
            } catch (e) {
                // If fetch fails (CORS or other), fall back to returning the direct URL so the browser
                // can attempt to load it normally (which may work if cookies or server token handling is allowed).
            }

            return endpointWithKey;
        } catch (e) {
            return null;
        }
    }
    
    function createSkeletonSlide(index) {
        const slide = document.createElement('div');
        slide.className = 'featuredItem skeleton-loading';
        slide.setAttribute('data-index', index);
        slide.style.background = 'linear-gradient(135deg, #2a2a2a, #3a3a3a)';
        slide.innerHTML = `
            <div class="featuredContent">
                <div class="featuredText">
                    <div class="skeleton-title"></div>
                    <div class="skeleton-subtitle"></div>
                    <div class="skeleton-rating"></div>
                </div>
            </div>
        `;
        return slide;
    }
    
    async function populateSlideWithData(slide, recommendation, index) {
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
            const apiKey = getJellyfinApiKey();
            const baseUrl = getJellyfinBaseUrl();
            let item = null;

            if (recommendation.id && apiKey) {
                try {
                    const url = `${baseUrl}/Items/${encodeURIComponent(recommendation.id)}?Fields=PrimaryImageAspectRatio,BackdropImageTags,ImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo&api_key=${apiKey}`;
                    const resp = await fetch(url);
                    if (resp.ok) item = await resp.json();
                } catch (er) {
                    // ignore
                }
            }

            if (!item && apiKey) {
                item = await searchForItem(recommendation.title, recommendation.year);
            }

            if (item) {
                try {
                    if (recommendation.id) slide.setAttribute('data-id', recommendation.id);

                    if (item.ImageTags && item.ImageTags.Primary) {
                        const posterImg = await fetchImageForDisplay(item.Id, 'Primary', apiKey, baseUrl);
                        if (posterImg) slide.setAttribute('data-poster-url', posterImg);
                    }

                    if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                        const backdropImg = await fetchImageForDisplay(item.Id, 'Backdrop', apiKey, baseUrl);
                        if (backdropImg) slide.setAttribute('data-backdrop-url', backdropImg);
                    }

                    const posterUrl = slide.getAttribute('data-poster-url');
                    if (posterUrl) {
                        slide.style.background = `url("${posterUrl}")`;
                        slide.style.backgroundSize = 'cover';
                        slide.style.backgroundPosition = 'center';
                        slide.style.backgroundRepeat = 'no-repeat';
                    }

                    if (item.ImageTags && item.ImageTags.Logo) {
                        const logoImgSrc = await fetchImageForDisplay(item.Id, 'Logo', apiKey, baseUrl);
                        const logoImg = slide.querySelector('.featuredLogo');
                        if (logoImgSrc) {
                            logoImg.src = logoImgSrc;
                            logoImg.style.display = 'block';
                        }
                    }
                } catch (e) {
                    // ignore individual image assignment failures
                }
            }
        } catch (e) {
            // Failed to fetch item details
        }
        
        // Remove skeleton class after data is loaded
        slide.classList.remove('skeleton-loading');
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
            const apiKey = getJellyfinApiKey();
            const baseUrl = getJellyfinBaseUrl();
            let item = null;

            if (recommendation.id && apiKey) {
                try {
                    const url = `${baseUrl}/Items/${encodeURIComponent(recommendation.id)}?Fields=PrimaryImageAspectRatio,BackdropImageTags,ImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo&api_key=${apiKey}`;
                    const resp = await fetch(url);
                    if (resp.ok) item = await resp.json();
                } catch (er) {
                    // ignore
                }
            }

            if (!item && apiKey) {
                item = await searchForItem(recommendation.title, recommendation.year);
            }

            if (item) {
                try {
                    if (recommendation.id) slide.setAttribute('data-id', recommendation.id);

                    if (item.ImageTags && item.ImageTags.Primary) {
                        const posterImg = await fetchImageForDisplay(item.Id, 'Primary', apiKey, baseUrl);
                        if (posterImg) slide.setAttribute('data-poster-url', posterImg);
                    }

                    if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                        const backdropImg = await fetchImageForDisplay(item.Id, 'Backdrop', apiKey, baseUrl);
                        if (backdropImg) slide.setAttribute('data-backdrop-url', backdropImg);
                    }

                    const posterUrl = slide.getAttribute('data-poster-url');
                    if (posterUrl) {
                        slide.style.background = `url("${posterUrl}")`;
                        slide.style.backgroundSize = 'cover';
                        slide.style.backgroundPosition = 'center';
                        slide.style.backgroundRepeat = 'no-repeat';
                    }

                    if (item.ImageTags && item.ImageTags.Logo) {
                        const logoImgSrc = await fetchImageForDisplay(item.Id, 'Logo', apiKey, baseUrl);
                        const logoImg = slide.querySelector('.featuredLogo');
                        if (logoImgSrc) {
                            logoImg.src = logoImgSrc;
                            logoImg.style.display = 'block';
                        }
                    }
                } catch (e) {
                    // ignore individual image assignment failures
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

                                // Ensure clones use the poster image (if available) instead of inheriting
                                // the active slide's backdrop which may have been applied inline.
                                try {
                                    const posterUrl = clone.getAttribute('data-poster-url');
                                    if (posterUrl) {
                                        clone.style.background = `url("${posterUrl}")`;
                                        clone.style.backgroundSize = 'cover';
                                        clone.style.backgroundPosition = 'center';
                                        clone.style.backgroundRepeat = 'no-repeat';
                                    } else {
                                        clone.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
                                    }
                                } catch (e) {}

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

                // Calculate the center offset to center the active item
                const containerCenter = containerRect.width / 2;
                const slideCenter = slideRect.width / 2;
                const delta = slideRect.left - containerRect.left;
                const centerOffset = containerCenter - slideCenter;
                const targetLeft = Math.max(0, Math.round(carouselContainer.scrollLeft + delta - centerOffset));

                carouselContainer.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } catch (e) {
                try { targetSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (er) {}
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
                // Stop propagation to prevent Jellyfin's tab navigation from intercepting
                e.stopPropagation();
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
                // Stop propagation to prevent Jellyfin navigation
                e.stopPropagation();
            } else if (isSwiping) {
                // If horizontal movement was detected but didn't meet threshold, still stop propagation
                e.stopPropagation();
            }

            // reset
            activePointerId = null;
            isSwiping = false;
        }

        // Use non-passive listeners so we can call preventDefault() to stop page scrolling
        rootEl.addEventListener('pointerdown', onPointerDown, { passive: false });
        rootEl.addEventListener('pointermove', onPointerMove, { passive: false });
        rootEl.addEventListener('pointerup', onPointerUp, { passive: false });
        rootEl.addEventListener('pointercancel', onPointerUp, { passive: false });
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
        if (document.getElementById('jellyfeatured_div')) {
            console.log('[Jellyfeatured] createFeaturedCarousel: already inserted, skipping');
            return;
        }
        if (document.body.dataset.jellyfeaturedInserting === 'true') {
            console.log('[Jellyfeatured] createFeaturedCarousel: insertion already in progress, skipping');
            return;
        }

        const pathname = window.location.pathname;
        const hash = window.location.hash;
        console.log('[Jellyfeatured] createFeaturedCarousel: pathname =', pathname, '| hash =', hash);
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            console.log('[Jellyfeatured] createFeaturedCarousel: pathname did not match home routes, skipping');
            return;
        }

        const targetContainer = document.querySelector('.homePage');
        if (!targetContainer) {
            console.log('[Jellyfeatured] createFeaturedCarousel: .homePage container not found in DOM');
            return;
        }
        console.log('[Jellyfeatured] createFeaturedCarousel: .homePage found, inserting carousel');

        // Mark that an insertion is in progress so parallel calls bail out
        document.body.dataset.jellyfeaturedInserting = 'true';

        try {
            // Do not add a full-page blocking overlay; allow users to interact
            // with the page while the featured carousel loads in the background.

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlTemplate;
            const featuredDiv = tempDiv.firstElementChild;

            if (featuredDiv) {
                const carouselContainer = featuredDiv.querySelector('#featured_items');
                const dotsContainer = featuredDiv.querySelector('#featuredDots');
                
                console.log('[Jellyfeatured] featuredDiv parsed, recommendations.length =', recommendations.length, '| carouselContainer =', !!carouselContainer);
                if (carouselContainer && recommendations.length > 0) {
                    const loadingSlide = carouselContainer.querySelector('.loadingSlide');
                    if (loadingSlide) {
                        loadingSlide.remove();
                    }
                    
                    // First pass: Create and inject skeleton slides immediately
                    const skeletonSlides = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const skeleton = createSkeletonSlide(i);
                        carouselContainer.appendChild(skeleton);
                        skeletonSlides.push(skeleton);
                        
                        if (i === 0) {
                            skeleton.classList.add('active');
                        }
                    }
                    
                    // Clone skeleton slides for infinite scroll effect
                    if (!carouselContainer.dataset.initialCloned) {
                        skeletonSlides.forEach((origSlide) => {
                            const clone = origSlide.cloneNode(true);
                            clone.classList.remove('active', 'entering', 'exiting');
                            clone.setAttribute('data-clone', 'initial');
                            carouselContainer.appendChild(clone);
                        });
                        carouselContainer.dataset.initialCloned = 'true';
                    }
                    
                    currentSlide = 0;
                    
                    // Second pass: Populate slides with actual data asynchronously
                    const populatePromises = [];
                    for (let i = 0; i < recommendations.length; i++) {
                        const rec = recommendations[i];
                        const slide = skeletonSlides[i];
                        populatePromises.push(populateSlideWithData(slide, rec, i));
                    }
                    
                    // Wait for all data to be populated
                    await Promise.all(populatePromises);
                    
                    // Update the first slide with backdrop if available
                    const firstSlide = carouselContainer.querySelector('.featuredItem.active');
                    if (firstSlide) {
                        const backdropUrl = firstSlide.getAttribute('data-backdrop-url');
                        if (backdropUrl) {
                            firstSlide.style.background = `url("${backdropUrl}")`;
                            firstSlide.style.backgroundSize = 'cover';
                            firstSlide.style.backgroundPosition = 'center';
                        }
                    }
                    
                    // Update clones with actual data after original slides are populated
                    const clones = carouselContainer.querySelectorAll('[data-clone="initial"]');
                    clones.forEach((clone, idx) => {
                        const originalSlide = skeletonSlides[idx];
                        if (originalSlide) {
                            // Copy attributes and styles
                            clone.setAttribute('data-title', originalSlide.getAttribute('data-title'));
                            clone.setAttribute('data-year', originalSlide.getAttribute('data-year'));
                            clone.setAttribute('data-id', originalSlide.getAttribute('data-id') || '');
                            clone.setAttribute('tabindex', '0');
                            clone.setAttribute('role', 'button');
                            clone.setAttribute('aria-label', originalSlide.getAttribute('aria-label'));
                            
                            const posterUrl = originalSlide.getAttribute('data-poster-url');
                            const backdropUrl = originalSlide.getAttribute('data-backdrop-url');
                            if (posterUrl) clone.setAttribute('data-poster-url', posterUrl);
                            if (backdropUrl) clone.setAttribute('data-backdrop-url', backdropUrl);
                            
                            // Apply poster background
                            if (posterUrl) {
                                clone.style.background = `url("${posterUrl}")`;
                                clone.style.backgroundSize = 'cover';
                                clone.style.backgroundPosition = 'center';
                                clone.style.backgroundRepeat = 'no-repeat';
                            } else {
                                clone.style.background = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
                            }
                            
                            // Copy innerHTML
                            clone.innerHTML = originalSlide.innerHTML;
                            clone.classList.remove('skeleton-loading');
                        }
                    });

                    carouselContainer.addEventListener('click', async (e) => {
                        // Ignore clicks immediately after a swipe or drag to avoid accidental navigation
                        const now = Date.now();
                        if (now - lastSwipeTime < 350 || now - lastDragTime < 350) {
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

                    // Desktop: click-and-drag scrolling (mouse) with click-suppression after drag
                    try {
                        let isMouseDown = false;
                        let mouseStartX = 0;
                        let mouseScrollStart = 0;
                        let isDraggingMouse = false;
                        let desiredScrollLeft = null;
                        let rafId = null;

                        function applyScroll() {
                            if (rafId) {
                                rafId = requestAnimationFrame(() => {
                                    if (desiredScrollLeft !== null) {
                                        carouselContainer.scrollLeft = Math.round(desiredScrollLeft);
                                        lastDragTime = Date.now();
                                    }
                                    rafId = null;
                                });
                            } else {
                                rafId = requestAnimationFrame(() => {
                                    if (desiredScrollLeft !== null) {
                                        carouselContainer.scrollLeft = Math.round(desiredScrollLeft);
                                        lastDragTime = Date.now();
                                    }
                                    rafId = null;
                                });
                            }
                        }

                        function onMouseDown(e) {
                            if (e.button !== 0) return;
                            const featuredDiv = document.getElementById('jellyfeatured_div');
                            if (!featuredDiv || !featuredDiv.contains(e.target)) return;

                            isMouseDown = true;
                            mouseStartX = e.clientX;
                            mouseScrollStart = carouselContainer.scrollLeft;
                            isDraggingMouse = false;
                            desiredScrollLeft = null;
                            pauseAutoSlide();
                            try { document.body.style.userSelect = 'none'; } catch (er) {}
                            try { carouselContainer.style.cursor = 'grabbing'; } catch (er) {}
                        }

                        function onMouseMove(e) {
                            if (!isMouseDown) return;
                            const dx = e.clientX - mouseStartX;
                            if (!isDraggingMouse && Math.abs(dx) > 5) {
                                isDraggingMouse = true;
                            }
                            if (isDraggingMouse) {
                                desiredScrollLeft = mouseScrollStart - dx;
                                applyScroll();
                                try { e.preventDefault(); } catch (er) {}
                            }
                        }

                        function onMouseUp(e) {
                            if (!isMouseDown) return;
                            isMouseDown = false;
                            // only record drag time if an actual drag occurred
                            if (isDraggingMouse) {
                                lastDragTime = Date.now();
                            }
                            isDraggingMouse = false;
                            desiredScrollLeft = null;
                            try { document.body.style.userSelect = ''; } catch (er) {}
                            try { carouselContainer.style.cursor = ''; } catch (er) {}
                        }

                        carouselContainer.addEventListener('mousedown', onMouseDown, { passive: true });
                        document.addEventListener('mousemove', onMouseMove, { passive: false });
                        document.addEventListener('mouseup', onMouseUp, { passive: true });
                    } catch (e) {}

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

                // No full-page overlay used; nothing to remove here.
            }
        } finally {
            try { delete document.body.dataset.jellyfeaturedInserting; } catch (e) { document.body.removeAttribute('data-jellyfeatured-inserting'); }
        }
    }

    // Refresh handler: remove existing featured div and re-run initialization
    function refreshFeatured() {
        try {
            const existing = document.getElementById('jellyfeatured_div');
            if (existing) existing.remove();
        } catch (e) {}

        // clear insertion flag if set
        try { delete document.body.dataset.jellyfeaturedInserting; } catch (e) { try { document.body.removeAttribute('data-jellyfeatured-inserting'); } catch (er) {} }

        // schedule a recreate
        setTimeout(() => {
            try { createFeaturedCarousel(); } catch (e) {}
        }, 100);
    }

    // Listen for manual refresh requests via localStorage (cross-window)
    window.addEventListener('storage', (e) => {
        if (!e) return;
        if (e.key === 'jellyfeatured_refresh') {
            try { refreshFeatured(); } catch (err) {}
        }
    });

    // BroadcastChannel listener for immediate same-origin delivery (and polling fallback)
    try {
        try {
            const bc = new BroadcastChannel('jellyfeatured');
            bc.addEventListener('message', (ev) => {
                try {
                    if (ev && ev.data && ev.data.type === 'refresh') {
                        refreshFeatured();
                    }
                } catch (e) {}
            });
        } catch (e) {}

        // Poll localStorage as a fallback in case storage events are missed
        let lastSeenRefresh = null;
        try { lastSeenRefresh = localStorage.getItem('jellyfeatured_refresh'); } catch (e) { lastSeenRefresh = null; }
        setInterval(() => {
            try {
                const v = localStorage.getItem('jellyfeatured_refresh');
                if (v && v !== lastSeenRefresh) {
                    lastSeenRefresh = v;
                    refreshFeatured();
                }
            } catch (e) {}
        }, 1000);
    } catch (e) {}

    let initAttempts = 0;
    const maxInitAttempts = 10;
    
    function tryInitialize() {
        const targetContainer = document.querySelector('.homePage');
        const alreadyInserted = !!document.getElementById('jellyfeatured_div');
        console.log(`[Jellyfeatured] tryInitialize attempt ${initAttempts}: .homePage=${!!targetContainer}, alreadyInserted=${alreadyInserted}`);
        if (targetContainer && !alreadyInserted) {
            createFeaturedCarousel();
        } else if (initAttempts < maxInitAttempts) {
            initAttempts++;
            setTimeout(tryInitialize, 500);
        } else {
            console.log('[Jellyfeatured] tryInitialize: max attempts reached without finding .homePage');
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