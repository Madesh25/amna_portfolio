/**
 * publicApp.js
 * Frontend rendering logic for Amna's World
 * Connects to the GitHub API via Aman.Amna/js/github.js to fetch content.
 */

function publicApp() {
    return {
        isLoading: true,
        api: null,

        // Data Arrays
        recipes: [],
        blogs: [],
        quotes: [],
        images: [],
        about: '',
        recipeHighlights: [],
        anthemPlaying: false,
        activeRecipe: null,

        // Lightbox State
        lightboxOpen: false,
        lightboxImage: '',
        openLightbox(url) {
            this.lightboxImage = url;
            this.lightboxOpen = true;
            document.body.style.overflow = 'hidden';
        },
        closeLightbox() {
            this.lightboxOpen = false;
            setTimeout(() => { this.lightboxImage = ''; }, 300);
            document.body.style.overflow = '';
        },

        initApp() {
            // Need a slight delay to ensure github.js is fully loaded
            setTimeout(() => {
                if (window.github) {
                    this.api = window.github;
                    // Always force-set repo info to ensure images load correctly
                    this.api.setRepoInfo('Madesh25', 'amna_portfolio');
                    this.fetchAllContent();
                } else {
                    console.error("GitHub API module not found!");
                    this.isLoading = false;
                }
            }, 100);
        },

        toggleAnthem() {
            const audio = document.getElementById('rm-audio');
            if (!audio) return;

            if (this.anthemPlaying) {
                audio.pause();
                this.anthemPlaying = false;
            } else {
                audio.play().then(() => {
                    this.anthemPlaying = true;
                }).catch(err => {
                    console.error("Audio playback failed:", err);
                    alert("Please ensure the hala-madrid.mp3 file exists in the /content/audio/ folder!");
                });
            }
        },

        async fetchAllContent() {
            this.isLoading = true;
            this.images = [];
            this.quotes = [];
            this.recipes = [];
            this.blogs = [];
            this.recipeHighlights = [];

            try {
                // Fetch all data in parallel
                await Promise.all([
                    this.fetchImages(),
                    this.fetchQuotes(),
                    this.fetchMarkdownData('recipes', this.recipes),
                    this.fetchMarkdownData('blogs', this.blogs),
                    this.fetchSingleMarkdownData('about', 'about'),
                    this.fetchSingleMarkdownData('store', 'store')
                ]);
            } catch (err) {
                console.error("Failed to load content:", err);
            } finally {
                // Add an artificial delay to show off the cool football loader
                setTimeout(() => {
                    this.isLoading = false;
                    this.initializeMasonryIfPresent();
                    this.scrollToRecipeIfPresent();
                }, 1000);
            }
        },

        async fetchImages() {
            try {
                const rawImages = await this.api.getContents('img/photos');
                if (Array.isArray(rawImages) && rawImages.length > 0) {
                    // Sort descending (newest timestamp first based on auto-generated filename: 177xxxxxxx-name.jpg)
                    this.images = rawImages.sort((a, b) => b.name.localeCompare(a.name));
                }
            } catch (err) {
                console.warn("No images found or error fetching images.");
            }
        },

        async fetchQuotes() {
            try {
                const quoteFiles = await this.api.getContents('content/quotes');
                if (Array.isArray(quoteFiles) && quoteFiles.length > 0) {
                    const quotesPromises = quoteFiles.map(async (file) => {
                        const fileData = await this.api.getFileContent(`content/quotes/${file.name}`);
                        try {
                            const parsed = JSON.parse(fileData.content);
                            // Detect Arabic characters in the quote body or author name
                            const arabicRegex = /[\u0600-\u06FF]/;
                            parsed.isArabic = arabicRegex.test(parsed.quote) || arabicRegex.test(parsed.author);
                            return parsed;
                        } catch (e) {
                            console.error("Error parsing quote JSON:", file.name, e, "\nContent was:", fileData.content);
                            return null;
                        }
                    });
                    const resolvedQuotes = await Promise.all(quotesPromises);
                    this.quotes = resolvedQuotes.filter(q => q !== null);
                }
            } catch (err) {
                console.warn("No quotes found or error fetching quotes.");
            }
        },

        async fetchMarkdownData(folderName, targetArray) {
            try {
                const files = await this.api.getContents(`content/${folderName}`);
                if (Array.isArray(files) && files.length > 0) {
                    const filePromises = files.map(async (file) => {
                        const fileData = await this.api.getFileContent(`content/${folderName}/${file.name}`);
                        const filenameTitle = file.name.replace('.md', '').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                        let rawContent = fileData.content;

                        // Rewrite local markdown links (![]( /content/images/xyz )) to valid Github Raw / Mock URLs
                        const imageSyntaxMatches = rawContent.match(/!\[.*?\]\((.*?)\)/g);
                        let highlightImg = null;
                        let firstFoundImg = null;

                        if (imageSyntaxMatches) {
                            for (const fullMatch of imageSyntaxMatches) {
                                const urlMatch = fullMatch.match(/\((.*?)\)/);
                                const isExplicitThumbnail = fullMatch.toLowerCase().includes('![thumbnail]');

                                if (urlMatch && urlMatch[1]) {
                                    const localPath = urlMatch[1];
                                    if (localPath.startsWith('/img/photos/')) {
                                        const filename = localPath.split('/').pop();
                                        const imgInGallery = this.images.find(img => img.name === filename);

                                        const resolvedUrl = imgInGallery
                                            ? imgInGallery.download_url
                                            : `https://raw.githubusercontent.com/${this.api.owner || 'YOUR_GITHUB_USERNAME'}/${this.api.repo || 'amna'}/main${localPath}`;

                                        // Keep track of the first image as a fallback
                                        if (!firstFoundImg) firstFoundImg = resolvedUrl;

                                        // If user explicitly tagged this as thumbnail, prioritize it immediately
                                        if (isExplicitThumbnail) {
                                            highlightImg = resolvedUrl;
                                        }

                                        // Inject valid URL directly into the markdown body to render beautifully
                                        // Also strip out the internal '[thumbnail]' tag if present so it doesn't show in HTML alt text
                                        let updatedSyntax = fullMatch.replace(localPath, resolvedUrl);
                                        if (isExplicitThumbnail) {
                                            updatedSyntax = updatedSyntax.replace(/!\[thumbnail\]/i, '![]');
                                        }
                                        rawContent = rawContent.replace(fullMatch, updatedSyntax);
                                    }
                                }
                            }

                            // If no explicit thumbnail was tagged, fallback to the very first image found
                            if (!highlightImg && firstFoundImg) {
                                highlightImg = firstFoundImg;
                            }
                        }

                        if (folderName === 'recipes' && highlightImg) {
                            this.recipeHighlights.push({
                                img: highlightImg,
                                recipeFile: file.name
                            });
                        }

                        return {
                            id: file.sha,
                            filename: file.name,
                            title: filenameTitle,
                            htmlContent: window.marked ? window.marked.parse(rawContent) : rawContent,
                            highlightImg: highlightImg,
                            date: new Date().toLocaleDateString()
                        };
                    });

                    const resolvedFiles = await Promise.all(filePromises);
                    resolvedFiles.forEach(item => targetArray.push(item));
                }
            } catch (err) {
                console.warn(`Error fetching ${folderName}`);
            }
        },

        async fetchSingleMarkdownData(folderName, targetProperty) {
            try {
                const files = await this.api.getContents(`content/${folderName}`);
                if (Array.isArray(files) && files.length > 0) {
                    // Just take the very first file found in About or Store folder
                    const file = files[0];
                    const fileData = await this.api.getFileContent(`content/${folderName}/${file.name}`);
                    this[targetProperty] = window.marked ? window.marked.parse(fileData.content) : fileData.content;
                } else {
                    // Fallback to fetch native file if mock DB returned empty
                    try {
                        const directRes = await fetch(`/content/${folderName}/${folderName}.md`);
                        if (directRes.ok) {
                            const rawText = await directRes.text();
                            this[targetProperty] = window.marked ? window.marked.parse(rawText) : rawText;
                        }
                    } catch (e) {
                        console.warn('Native fallback failed', e);
                    }
                }
            } catch (err) {
                console.warn(`Error fetching ${folderName} single data`);
            }
        },

        scrollToRecipeIfPresent() {
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            if (id) {
                setTimeout(() => {
                    const el = document.getElementById('recipe-' + id.replace('.md', ''));
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Add a subtle highlight effect
                        el.style.transition = 'box-shadow 0.5s';
                        el.style.boxShadow = '0 0 20px rgba(255, 77, 109, 0.4)';
                        el.style.borderRadius = 'var(--radius-md)';
                        setTimeout(() => el.style.boxShadow = 'none', 2000);
                    }
                }, 100);
            }
        },

        openRecipeModal(recipe) {
            this.activeRecipe = recipe;
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        },

        closeRecipeModal() {
            this.activeRecipe = null;
            document.body.style.overflow = ''; // Restore routing
        },

        initializeMasonryIfPresent() {
            // Because images are loaded dynamically via x-for, Masonry layouts might need a tick to render.
            // alpine $nextTick equivalent if embedded inside fetch
            setTimeout(() => {
                const grid = document.querySelector('.bento-gallery');
                if (grid && window.Masonry) {
                    // If User ever adds Masonry library, init here. Otherwise standard CSS grid works.
                }
            }, 100);
        }
    }
}
