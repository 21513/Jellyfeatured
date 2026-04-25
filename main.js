const recommendations = JSON.parse(`{{RECOMMENDATIONS_DATA_JSON}}`);
const htmlTemplate = `{{HTML_TEMPLATE}}`;

console.log('[Jellyfeatured] Script loaded. Recommendations count:', recommendations.length);

// Inject a CSS rule synchronously so the browser reserves carousel space the
// instant Jellyfin adds any child to .homePage — before the first paint.
// This prevents layout shift entirely: the gap exists from the first render,
// and our placeholder div just fills it in when the MutationObserver fires.
(function() {
    const s = document.createElement('style');
    s.id = 'jellyfeatured-reserve';
    s.textContent =
        // When the first child of .homePage is NOT our div, push it down to
        // make room. Once our div is prepended it becomes :first-child and
        // this rule no longer applies to the section below it.
        '.homePage > :first-child:not(#jellyfeatured_div) { margin-top: 50vh !important; }';
    (document.head || document.documentElement).appendChild(s);
})();

// Inject the full plugin CSS (from main.css, baked into htmlTemplate) into <head>
// once at startup so styles are available on every page — including the player.
(function() {
    if (document.getElementById('jellyfeatured-styles')) return;
    const match = htmlTemplate.match(/<style>([\s\S]*?)<\/style>/);
    if (!match) return;
    const s = document.createElement('style');
    s.id = 'jellyfeatured-styles';
    s.textContent = match[1];
    (document.head || document.documentElement).appendChild(s);
})();

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

                // Scroll so the active item's left edge aligns with the container's
                // padding-left — the same position the first item occupies on startup.
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
            }, +'{{AUTO_SLIDE_INTERVAL_MS}}');
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

    // Synchronously inserts the carousel shell with skeleton slides into the page.
    // Called the moment .homePage appears in the DOM so vertical space is reserved
    // before Jellyfin populates its own home sections — eliminating layout shift.
    function insertPlaceholderNow(targetContainer) {
        if (document.getElementById('jellyfeatured_div')) return;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlTemplate;
        const featuredDiv = tempDiv.firstElementChild;
        if (!featuredDiv) return;

        const carouselContainer = featuredDiv.querySelector('#featured_items');
        if (carouselContainer) {
            const count = recommendations.length > 0 ? recommendations.length : 5;
            for (let i = 0; i < count; i++) {
                const skeleton = createSkeletonSlide(i);
                if (i === 0) skeleton.classList.add('active');
                carouselContainer.appendChild(skeleton);
            }
        }

        targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);

        // CSS reserve rule is no longer needed — our div is now :first-child.
        document.getElementById('jellyfeatured-reserve')?.remove();
    }

    async function createFeaturedCarousel() {
        // Skip if async population is already running.
        if (document.body.dataset.jellyfeaturedInserting === 'true') {
            return;
        }

        const pathname = window.location.pathname;
        const hash = window.location.hash;
        console.log('[Jellyfeatured] createFeaturedCarousel: pathname =', pathname, '| hash =', hash);
        // Match any path that looks like a Jellyfin home route, regardless of
        // what base path the server is mounted under (e.g. /jellyfin/web/).
        const isHomePath =
            pathname.includes('home') ||
            pathname === '/' ||
            /(?:^|\/)web\/?$/.test(pathname) ||
            /(?:^|\/)web\/index\.html$/.test(pathname);
        if (!isHomePath) {
            console.log('[Jellyfeatured] createFeaturedCarousel: pathname did not match home routes, skipping');
            return;
        }

        const targetContainer = document.querySelector('.homePage');
        if (!targetContainer) {
            console.log('[Jellyfeatured] createFeaturedCarousel: .homePage container not found in DOM');
            return;
        }

        // Insert placeholder now if not already done (e.g. called directly without MutationObserver).
        if (!document.getElementById('jellyfeatured_div')) {
            insertPlaceholderNow(targetContainer);
        }

        const featuredDiv = document.getElementById('jellyfeatured_div');
        if (!featuredDiv) return;

        document.body.dataset.jellyfeaturedInserting = 'true';

        try {
                const carouselContainer = featuredDiv.querySelector('#featured_items');
                const dotsContainer = featuredDiv.querySelector('#featuredDots');
                
                console.log('[Jellyfeatured] featuredDiv found, recommendations.length =', recommendations.length, '| carouselContainer =', !!carouselContainer);
                if (carouselContainer && recommendations.length > 0) {
                    // Remove any loadingSlide left over from the placeholder.
                    carouselContainer.querySelector('.loadingSlide')?.remove();

                    // Collect existing skeleton slides inserted by insertPlaceholderNow.
                    // If the count doesn't match (placeholder used a default), rebuild.
                    let skeletonSlides = Array.from(
                        carouselContainer.querySelectorAll('.featuredItem:not([data-clone])')
                    ).sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index));

                    if (skeletonSlides.length !== recommendations.length) {
                        carouselContainer.querySelectorAll('.featuredItem').forEach(s => s.remove());
                        skeletonSlides = [];
                        for (let i = 0; i < recommendations.length; i++) {
                            const skeleton = createSkeletonSlide(i);
                            if (i === 0) skeleton.classList.add('active');
                            carouselContainer.appendChild(skeleton);
                            skeletonSlides.push(skeleton);
                        }
                    }

                    // Remove any clones from the placeholder pass and re-clone cleanly.
                    carouselContainer.querySelectorAll('[data-clone]').forEach(c => c.remove());
                    delete carouselContainer.dataset.initialCloned;
                    delete carouselContainer.dataset.appendedForLast;

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

                    // Populate slides with actual data asynchronously
                    const populatePromises = skeletonSlides.map((slide, i) =>
                        populateSlideWithData(slide, recommendations[i], i)
                    );

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

                        function onMouseDown(e) {
                            if (e.button !== 0) return;
                            const featuredDiv = document.getElementById('jellyfeatured_div');
                            if (!featuredDiv || !featuredDiv.contains(e.target)) return;

                            isMouseDown = true;
                            mouseStartX = e.clientX;
                            mouseScrollStart = carouselContainer.scrollLeft;
                            isDraggingMouse = false;
                            pauseAutoSlide();
                            try { document.body.style.userSelect = 'none'; } catch (er) {}
                            try { carouselContainer.style.cursor = 'grabbing'; } catch (er) {}
                            try { carouselContainer.style.scrollBehavior = 'auto'; } catch (er) {}
                        }

                        function onMouseMove(e) {
                            if (!isMouseDown) return;
                            const dx = e.clientX - mouseStartX;
                            if (!isDraggingMouse && Math.abs(dx) > 5) {
                                isDraggingMouse = true;
                            }
                            if (isDraggingMouse) {
                                carouselContainer.scrollLeft = mouseScrollStart - dx;
                                lastDragTime = Date.now();
                                try { e.preventDefault(); } catch (er) {}
                            }
                        }

                        function onMouseUp(e) {
                            if (!isMouseDown) return;
                            isMouseDown = false;
                            if (isDraggingMouse) {
                                lastDragTime = Date.now();
                            }
                            isDraggingMouse = false;
                            try { document.body.style.userSelect = ''; } catch (er) {}
                            try { carouselContainer.style.cursor = ''; } catch (er) {}
                            try { carouselContainer.style.scrollBehavior = ''; } catch (er) {}
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

    // ── Player overlay ────────────────────────────────────────────────────────
    let _overlayOsdObserver = null;
    // Set to true when the user stops playback so the MutationObserver's
    // repeated calls to initPlayerOverlay() don't re-inject the overlay.
    // Reset to false only when a new player navigation is detected.
    let _playerOverlaySuppressed = false;

    function isPlayerUrl() {
        const hash = location.hash || '';
        return hash.includes('/video') || hash.includes('playback');
    }

    function initPlayerOverlay() {
        if (_playerOverlaySuppressed) return;
        // Hard URL guard: never inject unless the browser is actually on a player route.
        // This stops the MutationObserver from re-injecting during home-page restoration
        // when the OSD element may still linger briefly in the DOM after stopping.
        if (!isPlayerUrl()) return;
        const osdPage =
            document.querySelector('[data-type="video-osd"]') ||
            document.getElementById('videoOsdPage');
        if (!osdPage) return;
        if (document.getElementById('jellyfeatured-player-overlay')) return;

        // Read the user-configured skip length in ms.
        // Jellyfin stores these in localStorage (key = 'skipForwardLength' / 'skipBackLength').
        // userSettings.skipForwardLength() reads from the same key with a default of 30000.
        function getConfiguredSkipMs(direction) {
            try {
                if (window.userSettings && typeof window.userSettings.skipForwardLength === 'function') {
                    return direction === 'forward'
                        ? window.userSettings.skipForwardLength()
                        : window.userSettings.skipBackLength();
                }
            } catch (e) {}
            try {
                const key = direction === 'forward' ? 'skipForwardLength' : 'skipBackLength';
                const val = localStorage.getItem(key);
                if (val) {
                    const parsed = parseInt(val, 10);
                    if (!isNaN(parsed) && parsed > 0) return parsed;
                }
            } catch (e) {}
            return direction === 'forward' ? 30000 : 10000;
        }

        // Skip using the best available method.
        function clickSkipButton(direction) {
            console.log('[Jellyfeatured] clickSkipButton:', direction);

            // 1 — playbackManager.fastForward() / rewind()
            //     These already read userSettings and convert to ticks internally.
            try {
                if (window.playbackManager) {
                    if (direction === 'forward') {
                        window.playbackManager.fastForward();
                    } else {
                        window.playbackManager.rewind();
                    }
                    console.log('[Jellyfeatured] skip via playbackManager');
                    return;
                }
            } catch (e) {}

            // 2 — playbackManager.seekRelative() — manual ticks calculation
            //     1 ms = 10 000 ticks
            try {
                if (window.playbackManager && typeof window.playbackManager.seekRelative === 'function') {
                    const skipMs  = getConfiguredSkipMs(direction);
                    const skipTicks = (direction === 'forward' ? 1 : -1) * skipMs * 10000;
                    window.playbackManager.seekRelative(skipTicks);
                    console.log('[Jellyfeatured] skip via seekRelative, ticks:', skipTicks);
                    return;
                }
            } catch (e) {}

            // 3 — Keyboard events: J = rewind, L = fast-forward (Jellyfin built-in shortcuts).
            //     Dispatched on document so Jellyfin's top-level keydown listener picks them up.
            try {
                const key     = direction === 'forward' ? 'l' : 'j';
                const code    = direction === 'forward' ? 'KeyL' : 'KeyJ';
                const keyCode = direction === 'forward' ? 76 : 74;
                const opts = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
                document.dispatchEvent(new KeyboardEvent('keydown', opts));
                document.dispatchEvent(new KeyboardEvent('keyup',   opts));
                console.log('[Jellyfeatured] skip via keyboard event:', key);
                return;
            } catch (e) {}

            // 4 — Direct video.currentTime manipulation (last resort, no server reporting).
            try {
                const video = document.querySelector('video');
                if (video && isFinite(video.currentTime) && video.duration > 0) {
                    const skipMs   = getConfiguredSkipMs(direction);
                    const skipSecs = (direction === 'forward' ? 1 : -1) * (skipMs / 1000);
                    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + skipSecs));
                    console.log('[Jellyfeatured] skip via video.currentTime, delta:', skipSecs);
                }
            } catch (e) {}
        }

        function setPlaybackRate(rate) {
            try {
                if (window.playbackManager) {
                    const player = window.playbackManager.getCurrentPlayer();
                    if (player && player.setPlaybackRate) {
                        player.setPlaybackRate(rate);
                        return;
                    }
                }
            } catch (e) {}
            // Fallback: set directly on the video element
            try {
                const video = document.querySelector('video');
                if (video) video.playbackRate = rate;
            } catch (e) {}
        }

        // Speed indicator — shown centred on screen while 2x is active
        let _speedIndicatorTimer = null;
        const speedIndicator = document.createElement('div');
        speedIndicator.id = 'jellyfeatured-speed-indicator';
        speedIndicator.classList.add('jellyfeaturedSpeedIndicator');
        speedIndicator.textContent = '2x';
        const speedIcon = document.createElement('img');
        speedIcon.src = '/Plugins/Jellyfeatured/fast-forward.svg';
        speedIcon.alt = '';
        speedIndicator.appendChild(speedIcon);

        function showSpeedIndicator() {
            if (!document.body.contains(speedIndicator)) document.body.appendChild(speedIndicator);
            if (_speedIndicatorTimer) clearTimeout(_speedIndicatorTimer);
            // Force reflow so transition plays from 0 even on repeat shows
            speedIndicator.style.opacity = '0';
            void speedIndicator.offsetWidth;
            speedIndicator.style.opacity = '1';
        }

        function hideSpeedIndicator() {
            speedIndicator.style.opacity = '0';
        }

        function makeSidePanel(side) {
            const panel = document.createElement('div');
            panel.className = 'jellyfeaturedPlayerPanel ' + side;

            // Block ALL events from reaching the video/OSD beneath
            const blockEvents = ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu'];
            blockEvents.forEach(type => {
                panel.addEventListener(type, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                }, { capture: true });
            });

            // Double-click: seek forward/back
            panel.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                const direction = side === 'left' ? 'back' : 'forward';
                console.log(`[Jellyfeatured] dblclick on ${side} panel → ${direction}`);
                clickSkipButton(direction);
            }, { capture: true });

            // Hold: 2x speed while pressed, restore on release
            let holdTimer = null;
            function onHoldStart(e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                holdTimer = setTimeout(() => {
                    holdTimer = null;
                    setPlaybackRate(2);
                    showSpeedIndicator();
                    console.log('[Jellyfeatured] Hold start: 2x speed');
                }, 300);
            }
            function onHoldEnd(e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (holdTimer !== null) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                } else {
                    // Was held — restore speed
                    setPlaybackRate(1);
                    hideSpeedIndicator();
                    console.log('[Jellyfeatured] Hold end: restored 1x speed');
                }
            }
            panel.addEventListener('pointerdown', onHoldStart, { capture: true });
            panel.addEventListener('pointerup',   onHoldEnd,   { capture: true });
            panel.addEventListener('pointercancel', onHoldEnd, { capture: true });

            return panel;
        }

        // Container is transparent to pointer events; panels explicitly opt back in.
        const overlay = document.createElement('div');
        overlay.id = 'jellyfeatured-player-overlay';
        overlay.appendChild(makeSidePanel('left'));
        overlay.appendChild(makeSidePanel('right'));
        document.body.appendChild(overlay);
        console.log('[Jellyfeatured] Player overlay injected');

        // Remove overlay the moment the OSD page leaves the DOM
        if (_overlayOsdObserver) _overlayOsdObserver.disconnect();
        _overlayOsdObserver = new MutationObserver(() => {
            const stillPresent =
                document.querySelector('[data-type="video-osd"]') ||
                document.getElementById('videoOsdPage');
            if (!stillPresent) {
                removePlayerOverlay();
                _overlayOsdObserver.disconnect();
                _overlayOsdObserver = null;
            }
        });
        _overlayOsdObserver.observe(document.body, { childList: true, subtree: true });

        // Also listen to Jellyfin's Events system if available (fires before DOM removal)
        try {
            const Events = window.Events || (window.require && window.require('events'));
            if (Events && window.playbackManager) {
                Events.on(window.playbackManager, 'playbackstop', function onStop() {
                    removePlayerOverlay();
                    Events.off(window.playbackManager, 'playbackstop', onStop);
                });
            }
        } catch (e) {}
    }

    function removePlayerOverlay() {
        _playerOverlaySuppressed = true;
        const el = document.getElementById('jellyfeatured-player-overlay');
        if (el) el.remove();
        const indicator = document.getElementById('jellyfeatured-speed-indicator');
        if (indicator) indicator.remove();
        if (_overlayOsdObserver) {
            _overlayOsdObserver.disconnect();
            _overlayOsdObserver = null;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    let initAttempts = 0;
    const maxInitAttempts = 10;
    
    function tryInitialize() {
        const targetContainer = document.querySelector('.homePage');
        const alreadyInserted = !!document.getElementById('jellyfeatured_div');
        console.log(`[Jellyfeatured] tryInitialize attempt ${initAttempts}: .homePage=${!!targetContainer}, alreadyInserted=${alreadyInserted}`);
        if (targetContainer && !alreadyInserted) {
            // Insert placeholder synchronously right now — no delay.
            insertPlaceholderNow(targetContainer);
            createFeaturedCarousel();
        } else if (!alreadyInserted && initAttempts < maxInitAttempts) {
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
        // Insert the placeholder synchronously the instant .homePage appears in
        // the DOM — before Jellyfin renders its own home sections — so the
        // carousel's vertical space is reserved and no layout shift occurs.
        const targetContainer = document.querySelector('.homePage');
        if (targetContainer && !document.getElementById('jellyfeatured_div')) {
            insertPlaceholderNow(targetContainer);
        }
        // Async data population can be scheduled normally.
        setTimeout(() => createFeaturedCarousel(), 500);
        // Player overlay — only attempt if not suppressed (suppression is cleared
        // by the URL-change watcher when a genuine player navigation occurs).
        setTimeout(() => initPlayerOverlay(), 100);
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            initAttempts = 0;
            setTimeout(() => tryInitialize(), 200);
            if (isPlayerUrl()) {
                // Navigating TO the player: clear suppression so the overlay can inject.
                removePlayerOverlay();
                _playerOverlaySuppressed = false;
                setTimeout(() => initPlayerOverlay(), 300);
            } else {
                // Navigating AWAY from the player: remove overlay and keep suppressed.
                // Suppression is NOT cleared here; it is only cleared above when a
                // genuine player navigation is detected. This prevents the
                // MutationObserver from re-injecting during home-page restoration.
                removePlayerOverlay();
            }
        }
    }, 1000);
})();