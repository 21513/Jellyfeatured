export default function() {
    function createFeaturedDiv() {
        if (document.getElementById('jellyfeatured-div')) {
            return;
        }

        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }

        const containers = [
            '.homePage',
            '.homePageContent',
            '.view.pageContainer',
            '[data-role="main"]',
            '.scrollY',
            '.pageContainer',
            '.sections',
            'main',
            'body'
        ];
        
        let targetContainer = null;
        for (const selector of containers) {
            targetContainer = document.querySelector(selector);
            if (targetContainer) {
                break;
            }
        }
        
        if (targetContainer) {
            const featuredDiv = document.createElement('div');
            featuredDiv.id = 'jellyfeatured-div';
            featuredDiv.style.cssText = `
                width: 100%;
                height: 200px;
                background: linear-gradient(135deg, #1e3a8a, #3b82f6);
                margin: 20px 0;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
                font-weight: bold;
                position: relative;
                z-index: 1000;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            featuredDiv.innerHTML = 'Jellyfeatured';

            if (targetContainer.firstChild) {
                targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            } else {
                targetContainer.appendChild(featuredDiv);
            }
        } else {
            console.log('Jellyfeatured: No suitable container found');
        }
    }

    function attemptInjection() {
        createFeaturedDiv();
    }
    
    attemptInjection();

    const observer = new MutationObserver(() => {
        setTimeout(createFeaturedDiv, 200);
    });
    
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    let lastUrl = location.href;
    function checkUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(attemptInjection, 100);
        }
    }
    
    setInterval(checkUrlChange, 1000);
}