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
            console.log('[JELLYFEATURED] No API key available for search');
            return null;
        }
        
        try {
            const searchUrl = `${baseUrl}/Items?searchTerm=${encodeURIComponent(title)}&Recursive=true&Fields=PrimaryImageAspectRatio,BackdropImageTags,ImageTags&ImageTypeLimit=1&EnableImageTypes=Primary,Backdrop,Logo&Limit=5&api_key=${apiKey}`;
            
            console.log('[JELLYFEATURED] Searching with URL:', searchUrl);
            const response = await fetch(searchUrl);
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('[JELLYFEATURED] Search results for', title, ':', data.Items?.length || 0, 'items');
            
            if (data.Items && data.Items.length > 0) {
                let bestMatch = data.Items[0];
                
                if (year) {
                    const yearMatch = data.Items.find(item => 
                        item.PremiereDate && new Date(item.PremiereDate).getFullYear().toString() === year
                    );
                    if (yearMatch) {
                        bestMatch = yearMatch;
                        console.log('[JELLYFEATURED] Found year match for', title, year);
                    }
                }
                
                return bestMatch;
            }
        } catch (e) {
            console.log('[JELLYFEATURED] Search error for', title, ':', e.message);
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
        
        // Add a small delay to ensure DOM is fully rendered
        setTimeout(() => {
            const prevButton = document.querySelector('#jellyfeatured_div #featured-prev');
            const nextButton = document.querySelector('#jellyfeatured_div #featured-next');
            
            console.log('[JELLYFEATURED] Prev button found:', !!prevButton);
            console.log('[JELLYFEATURED] Next button found:', !!nextButton);
            
            if (prevButton) {
                // Remove any existing listeners
                prevButton.replaceWith(prevButton.cloneNode(true));
                const newPrevButton = document.querySelector('#jellyfeatured_div #featured-prev');
            
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
                const newNextButton = document.querySelector('#jellyfeatured_div #featured-next');
                
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
        }, 100); // 100ms delay to ensure DOM is ready
    }
    
    function goToSlide(index) {
        console.log('[JELLYFEATURED] goToSlide called with index:', index, 'current:', currentSlide);
        
        if (filteredRecommendations.length === 0 || index >= filteredRecommendations.length || index === currentSlide) {
            console.log('[JELLYFEATURED] goToSlide aborted - invalid index or same slide');
            return;
        }
        
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        currentSlide = index;
        
        // Calculate position based on new infinite scroll layout with relative dimensions
        const { primaryWidth, posterWidth, gap } = getItemDimensions();
        const itemWidth = posterWidth + gap;
        const primaryItemWidth = primaryWidth + gap;
        
        const translateX = currentSlide === 0 ? -itemWidth : -(itemWidth + primaryItemWidth + (currentSlide - 1) * itemWidth);
        itemsContainer.style.transform = `translateX(${translateX}px)`;
        
        updatePrimaryItem();
        resetProgressBar();
        startProgressBar();
        
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
    
    
    function getItemDimensions() {
        // Get computed CSS custom property values
        const jellyfeaturedDiv = document.getElementById('jellyfeatured_div');
        if (!jellyfeaturedDiv) return { primaryWidth: 720, posterWidth: 270, gap: 16, baseHeight: 405 };
        
        const computedStyle = getComputedStyle(jellyfeaturedDiv);
        const baseHeight = parseFloat(computedStyle.getPropertyValue('--carousel-base-height').replace('px', ''));
        const gap = parseFloat(computedStyle.getPropertyValue('--item-gap').replace('rem', '')) * 16; // Convert rem to px
        
        // Calculate widths based on aspect ratios
        const primaryAspectRatio = 16/9;
        const posterAspectRatio = 2/3;
        
        const primaryWidth = baseHeight * primaryAspectRatio;
        const posterWidth = baseHeight * posterAspectRatio;
        
        return { primaryWidth, posterWidth, gap, baseHeight };
    }
    
    function nextSlide() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        const totalItems = filteredRecommendations.length;
        const { primaryWidth, posterWidth, gap } = getItemDimensions();
        const itemWidth = posterWidth + gap;
        const primaryItemWidth = primaryWidth + gap;
        
        if (currentSlide === totalItems - 1) {
            // Going from last item to first - use cloned first item for seamless transition
            const currentTransform = itemsContainer.style.transform.match(/-?[\d.]+/);
            const currentX = currentTransform ? parseFloat(currentTransform[0]) : 0;
            const newX = currentX - itemWidth;
            
            itemsContainer.style.transform = `translateX(${newX}px)`;
            
            // After animation completes, jump to actual first item
            setTimeout(() => {
                currentSlide = 0;
                itemsContainer.style.transition = 'none';
                itemsContainer.style.transform = `translateX(-${itemWidth}px)`;
                
                setTimeout(() => {
                    itemsContainer.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                    updatePrimaryItem();
                }, 50);
            }, 600);
        } else {
            // Normal progression
            currentSlide = (currentSlide + 1) % totalItems;
            const translateX = currentSlide === 0 ? -itemWidth : -(itemWidth + primaryItemWidth + (currentSlide - 1) * itemWidth);
            itemsContainer.style.transform = `translateX(${translateX}px)`;
            updatePrimaryItem();
        }
        
        resetProgressBar();
        startProgressBar();
        console.log('[JELLYFEATURED] Advanced to slide:', currentSlide);
    }
    
    function previousSlide() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        const totalItems = filteredRecommendations.length;
        const { primaryWidth, posterWidth, gap } = getItemDimensions();
        const itemWidth = posterWidth + gap;
        const primaryItemWidth = primaryWidth + gap;
        
        if (currentSlide === 0) {
            // Going from first item to last - use cloned last item for seamless transition
            const currentTransform = itemsContainer.style.transform.match(/-?[\d.]+/);
            const currentX = currentTransform ? parseFloat(currentTransform[0]) : 0;
            const newX = currentX + itemWidth;
            
            itemsContainer.style.transform = `translateX(${newX}px)`;
            
            // After animation completes, jump to actual last item
            setTimeout(() => {
                currentSlide = totalItems - 1;
                itemsContainer.style.transition = 'none';
                const lastItemX = -(itemWidth + primaryItemWidth + (totalItems - 2) * itemWidth);
                itemsContainer.style.transform = `translateX(${lastItemX}px)`;
                
                setTimeout(() => {
                    itemsContainer.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                    updatePrimaryItem();
                }, 50);
            }, 600);
        } else {
            // Normal progression
            currentSlide = (currentSlide - 1 + totalItems) % totalItems;
            const translateX = currentSlide === 0 ? -itemWidth : -(itemWidth + primaryItemWidth + (currentSlide - 1) * itemWidth);
            itemsContainer.style.transform = `translateX(${translateX}px)`;
            updatePrimaryItem();
        }
        
        resetProgressBar();
        startProgressBar();
        console.log('[JELLYFEATURED] Moved back to slide:', currentSlide);
    }

    function updatePrimaryItem() {
        const itemsContainer = document.getElementById('featured-items-container');
        if (!itemsContainer) return;
        
        // Remove primary class from all items
        const allItems = itemsContainer.querySelectorAll('.featured-item');
        allItems.forEach(item => {
            item.classList.remove('primary');
            item.classList.add('poster');
        });
        
        // Add primary class to current slide item
        const currentItem = itemsContainer.querySelector(`[data-actual-index="${currentSlide}"]`);
        if (currentItem) {
            currentItem.classList.remove('poster');
            currentItem.classList.add('primary');
        }
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
    
    async function preloadAndCacheImages() {
        console.log('[JELLYFEATURED] Preloading images for recommendations...');
        const apiKey = getJellyfinApiKey();
        const baseUrl = getJellyfinBaseUrl();
        
        if (!apiKey) {
            console.log('[JELLYFEATURED] No API key available for preloading');
            filteredRecommendations = recommendations.slice();
            return;
        }

        const preloadPromises = [];
        let processedCount = 0;

        for (const recommendation of recommendations) {
            try {
                console.log('[JELLYFEATURED] Searching for:', recommendation.title, recommendation.year);
                const item_data = await searchForItem(recommendation.title, recommendation.year);
                
                if (item_data) {
                    console.log('[JELLYFEATURED] Found item:', item_data.Name, 'ID:', item_data.Id);
                    // Load images at 50% resolution for faster loading
                    // Primary backdrop: 720px * 0.5 = 360px width
                    // Poster: 270px * 0.5 = 135px width
                    const backdropUrl = `${baseUrl}/Items/${item_data.Id}/Images/Backdrop?api_key=${apiKey}&maxWidth=360&maxHeight=203&quality=80`;
                    const posterUrl = `${baseUrl}/Items/${item_data.Id}/Images/Primary?api_key=${apiKey}&maxWidth=135&maxHeight=203&quality=80`;
                    
                    console.log('[JELLYFEATURED] Image URLs - Backdrop:', backdropUrl, 'Poster:', posterUrl);
                    
                    let logoUrl = null;
                    if (item_data.ImageTags && item_data.ImageTags.Logo) {
                        logoUrl = `${baseUrl}/Items/${item_data.Id}/Images/Logo?api_key=${apiKey}&maxWidth=200&maxHeight=100&quality=80`;
                    }
                    
                    // Store in cache
                    const cacheKey = `${recommendation.title}_${recommendation.year || ''}`;
                    imageCache.set(cacheKey, {
                        backdrop: backdropUrl,
                        poster: posterUrl,
                        logo: logoUrl,
                        itemData: item_data
                    });
                    
                    // Prioritize backdrop and poster, preload logo separately
                    preloadPromises.push(preloadImage(backdropUrl));
                    preloadPromises.push(preloadImage(posterUrl));
                    
                    // Preload logo with lower priority (don't wait for it)
                    if (logoUrl) {
                        preloadImage(logoUrl).catch(e => console.log('[JELLYFEATURED] Logo preload failed:', e.message));
                    }
                    
                    processedCount++;
                } else {
                    console.log('[JELLYFEATURED] No item found for:', recommendation.title, recommendation.year);
                }
            } catch (e) {
                console.log('[JELLYFEATURED] Failed to process recommendation:', recommendation.title, e.message);
            }
        }

        // Wait for only essential images (backdrop + poster), with timeout
        console.log('[JELLYFEATURED] Preloading', preloadPromises.length, 'essential images...');
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Preload timeout')), 5000)
        );
        
        try {
            await Promise.race([Promise.allSettled(preloadPromises), timeoutPromise]);
        } catch (e) {
            console.log('[JELLYFEATURED] Preload timeout reached, proceeding with cached images');
        }
        
        // All recommendations are already filtered server-side
        filteredRecommendations = recommendations;
        console.log('[JELLYFEATURED] Image preloading completed. Using all', filteredRecommendations.length, 'server-filtered recommendations');
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
                    // Show loading state
                    itemsContainer.innerHTML = `
                        <div class="featured-item primary" style="display: flex; align-items: center; justify-content: center; background: var(--cardBackgroundGradient); opacity: 0.8;">
                            <p style="color: var(--textColor); font-size: 1.2rem;">Loading featured content...</p>
                        </div>
                    `;
                    
                    // Preload images for all server-filtered recommendations  
                    await preloadAndCacheImages();
                    
                    if (filteredRecommendations.length === 0) {
                        console.log('[JELLYFEATURED] No valid recommendations after image preloading');
                        itemsContainer.innerHTML = `
                            <div class="featured-item primary" style="display: flex; align-items: center; justify-content: center; background: var(--cardBackgroundGradient);">
                                <p style="color: var(--textColor); font-size: 1.2rem;">No content available...</p>
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
                
                // Setup navigation buttons after injection
                setupNavigation();
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
        
        // Add fade out transition
        itemsContainer.style.opacity = '0.7';
        
        // Clear existing items after a short delay for smooth transition
        setTimeout(() => {
            itemsContainer.innerHTML = '';
            
            // Create true infinite scroll: clone last item + all items + clone first item
            const totalRecommendations = filteredRecommendations.length;
            
            // Clone last item at beginning for backwards infinite scroll
            const lastRecommendation = filteredRecommendations[totalRecommendations - 1];
            const clonedLastItem = createCarouselItemInlineFromCache(lastRecommendation, totalRecommendations - 1, false);
            clonedLastItem.classList.add('cloned-item');
            clonedLastItem.setAttribute('data-cloned', 'last');
            itemsContainer.appendChild(clonedLastItem);
            
            // Add all actual items
            for (let i = 0; i < totalRecommendations; i++) {
                const recommendation = filteredRecommendations[i];
                const isPrimary = (i === currentSlide);
                const item = createCarouselItemInlineFromCache(recommendation, i, isPrimary);
                item.setAttribute('data-actual-index', i);
                itemsContainer.appendChild(item);
            }
            
            // Clone first item at end for forward infinite scroll
            const firstRecommendation = filteredRecommendations[0];
            const clonedFirstItem = createCarouselItemInlineFromCache(firstRecommendation, 0, false);
            clonedFirstItem.classList.add('cloned-item');
            clonedFirstItem.setAttribute('data-cloned', 'first');
            itemsContainer.appendChild(clonedFirstItem);
            
            // Position container to show current slide (accounting for cloned item at start)
            const { primaryWidth, posterWidth, gap } = getItemDimensions();
            const itemWidth = posterWidth + gap;
            const primaryItemWidth = primaryWidth + gap;
            
            let translateX = 0;
            
            // Calculate position: skip cloned last item + position to current slide
            if (currentSlide === 0) {
                translateX = -(itemWidth); // Position to show first actual item (skip cloned last)
            } else {
                translateX = -(itemWidth + primaryItemWidth + (currentSlide - 1) * itemWidth);
            }
            
            itemsContainer.style.transform = `translateX(${translateX}px)`;
            itemsContainer.style.transition = 'none'; // No transition for initial positioning
            
            // Re-enable transitions after positioning
            setTimeout(() => {
                itemsContainer.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            }, 50);
            
            // Fade back in
            itemsContainer.style.opacity = '1';
            
            // Reset and start progress bar
            resetProgressBar();
            startProgressBar();
            
            console.log('[JELLYFEATURED] Infinite carousel items created for slide:', currentSlide);
        }, 150);
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
        
        console.log('[JELLYFEATURED] Creating item for:', recommendation.title, 'isPrimary:', isPrimary, 'cachedImages:', !!cachedImages);

        if (cachedImages) {
            if (isPrimary) {
                // Use backdrop for primary item
                const backgroundUrl = `url("${cachedImages.backdrop}")`;
                item.style.background = backgroundUrl;
                item.style.backgroundSize = 'cover';
                item.style.backgroundPosition = 'center';
                item.style.backgroundRepeat = 'no-repeat';
                
                console.log('[JELLYFEATURED] Applied primary background:', backgroundUrl);
                
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
                const backgroundUrl = `url("${cachedImages.poster}")`;
                item.style.background = backgroundUrl;
                item.style.backgroundSize = 'cover';
                item.style.backgroundPosition = 'center';
                item.style.backgroundRepeat = 'no-repeat';
                
                console.log('[JELLYFEATURED] Applied poster background:', backgroundUrl);
            }
        } else {
            // Fallback background if not in cache
            const fallbackBg = `linear-gradient(135deg, var(--darkerGradientPoint, #111827), var(--lighterGradientPoint, #1d2635))`;
            item.style.background = fallbackBg;
            console.log('[JELLYFEATURED] Applied fallback background for:', recommendation.title);
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