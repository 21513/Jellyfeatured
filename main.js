// Jellyfeatured Auto-Injector with Recommendations
console.log('🎬 Jellyfeatured: Auto-injector loaded');

const recommendations = [{{RECOMMENDATIONS_DATA}}];
const htmlInject = `{{HTML_TEMPLATE}}`;

(function() {
    function createFeaturedDiv() {
        if (document.getElementById('jellyfeatured-div')) return;
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        console.log('🎬 Jellyfeatured: Attempting injection...');
        
        const targetContainer = document.querySelector('.homePage');
        if (targetContainer) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = htmlInject;
            const featuredDiv = tempDiv.firstElementChild;
            
            if (featuredDiv) {
                // Generate recommendations HTML
                const container = featuredDiv.querySelector('#recommendations-container');
                if (container && recommendations.length > 0) {
                    container.innerHTML = recommendations.map(rec => `
                        <div class="recommendation-item">
                            <div class="recommendation-content">
                                <div class="recommendation-title">${rec.title} ${rec.year ? '(' + rec.year + ')' : ''}</div>
                                <div class="recommendation-type">${rec.type}</div>
                            </div>
                            <div class="recommendation-rating">
                                ⭐ ${rec.rating}
                            </div>
                        </div>
                    `).join('');
                } else if (container) {
                    container.innerHTML = '<p class="loading-text">Loading recommendations...</p>';
                }
                
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
                console.log('✅ Jellyfeatured: Successfully injected recommendations!');
            }
        }
    }
    
    // Multiple injection attempts
    createFeaturedDiv();
    setTimeout(createFeaturedDiv, 500);
    setTimeout(createFeaturedDiv, 1000);
    setTimeout(createFeaturedDiv, 2000);
    
    // Watch for navigation changes
    const observer = new MutationObserver(() => setTimeout(createFeaturedDiv, 300));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    // URL change detection
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(createFeaturedDiv, 200);
        }
    }, 1000);
})();