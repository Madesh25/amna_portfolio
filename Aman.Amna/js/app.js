// app.js
// Main application logic for the Admin Dashboard

const HARDCODED_PASSWORD = 'GOAT@MESSI'; // Required custom password

function adminApp() {
    return {
        isLoggedIn: false,
        sidebarOpen: false,
        currentTab: 'dashboard',
        viewMode: 'list', // 'list', 'create', 'edit'
        isLoading: false,
        isSaving: false,
        isDeleting: null,
        errorMsg: '',
        notification: { show: false, message: '', type: 'success' },

        loginForm: {
            password: '',
            token: ''
        },

        // Stats
        stats: {
            blogs: 0,
            recipes: 0,
            quotes: 0,
            media: 0,
            about: 0,
            store: 0
        },

        // Data Arrays
        contents: [],

        api: null,
        editor: null, // SimpleMDE instance

        editorForm: {
            filename: '',
            oldFilename: null,
            title: '',
            author: '',
            content: '',
            ingredients: '',
            instructions: '',
            fileObj: null,
            mediaPreview: '',
            mediaBase64: '',
        },
        attachedImages: [],
        isDeletingImage: null,
        imageSortOrder: 'newest',
        isSavingOrder: false,
        mediaError: '',
        isUploadingInEditor: false,
        activeEditor: null,
        recipeIngredientsEditor: null,
        recipeInstructionsEditor: null,

        init() {
            this.api = window.github;

            // Check auth state
            if (this.api.isAuthenticated() && sessionStorage.getItem('admin_logged_in') === 'true') {
                this.isLoggedIn = true;
                this.loadDashboardData();
            }
        },

        showNotification(message, type = 'success') {
            this.notification = { show: true, message, type };
            setTimeout(() => { this.notification.show = false; }, 3000);
        },

        async login() {
            this.errorMsg = '';

            // Brute force protection check
            let attempts = parseInt(localStorage.getItem('login_attempts') || '0');
            const lockoutTime = parseInt(localStorage.getItem('lockout_time') || '0');

            if (lockoutTime > Date.now()) {
                const remainingMinutes = Math.ceil((lockoutTime - Date.now()) / 60000);
                this.errorMsg = `Account locked. Try again in ${remainingMinutes} minute(s).`;
                return;
            }

            // Verify password
            if (this.loginForm.password !== HARDCODED_PASSWORD) {
                attempts += 1;
                localStorage.setItem('login_attempts', attempts);

                if (attempts >= 3) {
                    // Lock for 15 minutes
                    localStorage.setItem('lockout_time', Date.now() + 15 * 60000);
                    this.errorMsg = 'Too many failed attempts. Locked out for 15 minutes.';
                } else {
                    this.errorMsg = `Invalid credentials. ${3 - attempts} attempt(s) remaining.`;
                }
                return;
            }

            try {
                if (!this.loginForm.token) {
                    this.errorMsg = 'GitHub Access Token is strictly required.';
                    return;
                }

                // Initialize API token
                this.api.setToken(this.loginForm.token);

                // Fetch user logic to confirm token works
                const user = await this.api.getAuthenticatedUser();

                let owner = user.login;
                let repo = 'amna_portfolio'; // Explicitly bind to correct remote repository

                // Save to local storage
                this.api.setRepoInfo(owner, repo);

                // Reset attempts
                localStorage.removeItem('login_attempts');
                localStorage.removeItem('lockout_time');

                sessionStorage.setItem('admin_logged_in', 'true');
                this.isLoggedIn = true;
                this.loginForm = { password: '', token: '' };

                this.showNotification('Logged in successfully!');
                this.loadDashboardData();

            } catch (err) {
                this.errorMsg = 'GitHub Authentication Failed. Please check your token.';
                this.api.clearToken();
            }
        },

        logout() {
            this.api.clearToken();
            sessionStorage.removeItem('admin_logged_in');
            this.isLoggedIn = false;
            this.contents = [];
        },

        switchTab(tab) {
            this.currentTab = tab;
            this.viewMode = 'list';
            this.sidebarOpen = false;

            if (tab === 'dashboard') {
                this.loadDashboardData();
            } else {
                this.loadContents();
            }
        },

        refreshCurrentTab() {
            if (this.currentTab === 'dashboard') {
                this.loadDashboardData();
            } else {
                this.loadContents();
            }
        },

        async loadDashboardData() {
            try {
                const [blogs, recipes, quotes, images, videos, about, store] = await Promise.all([
                    this.api.getContents('content/blogs'),
                    this.api.getContents('content/recipes'),
                    this.api.getContents('content/quotes'),
                    this.api.getContents('img/photos'),
                    this.api.getContents('content/videos'),
                    this.api.getContents('content/about'),
                    this.api.getContents('content/store')
                ]);

                this.stats.blogs = blogs.length;
                this.stats.recipes = recipes.length;
                this.stats.quotes = quotes.length;
                this.stats.media = images.length + videos.length;
                this.stats.about = about.length;
                this.stats.store = store.length;
            } catch (err) {
                console.error('Error loading dashboard stats', err);
            }
        },

        async loadContents() {
            this.isLoading = true;
            this.contents = [];

            try {
                let path = `content/${this.currentTab}`;
                if (this.currentTab === 'images') path = 'img/photos';
                const data = await this.api.getContents(path);

                // Sort array descending to show newest uploaded timestamps first
                if (Array.isArray(data)) {
                    data.sort((a, b) => b.name.localeCompare(a.name));
                }
                this.contents = data;
            } catch (err) {
                this.showNotification('Failed to load contents: ' + err.message, 'error');
            } finally {
                this.isLoading = false;
            }
        },

        initEditor() {
            if (['blogs', 'about', 'store'].includes(this.currentTab)) {
                // Initialize standard SimpleMDE
                setTimeout(() => {
                    if (this.editor) {
                        this.editor.toTextArea();
                    }
                    this.editor = new SimpleMDE({
                        element: document.getElementById("markdown-editor"),
                        spellChecker: false,
                        forceSync: true
                    });
                    this.editor.value(this.editorForm.content);
                    this.activeEditor = this.editor;

                    // Parse initial attached images
                    this.parseAttachedImages();

                    // Listen for changes
                    this.editor.codemirror.on("change", () => this.parseAttachedImages());
                    this.editor.codemirror.on("focus", () => this.activeEditor = this.editor);

                    setTimeout(() => {
                        this.editor.codemirror.refresh();
                    }, 200);
                }, 100);
            } else if (this.currentTab === 'recipes') {
                // Initialize split Dual SimpleMDE editors
                setTimeout(() => {
                    if (!this.recipeIngredientsEditor) {
                        this.recipeIngredientsEditor = new SimpleMDE({ element: document.getElementById("markdown-ingredients"), spellChecker: false, forceSync: true });
                        this.recipeIngredientsEditor.codemirror.on("change", () => this.parseAttachedImages());
                        this.recipeIngredientsEditor.codemirror.on("focus", () => this.activeEditor = this.recipeIngredientsEditor);
                    }
                    if (!this.recipeInstructionsEditor) {
                        this.recipeInstructionsEditor = new SimpleMDE({ element: document.getElementById("markdown-instructions"), spellChecker: false, forceSync: true });
                        this.recipeInstructionsEditor.codemirror.on("change", () => this.parseAttachedImages());
                        this.recipeInstructionsEditor.codemirror.on("focus", () => this.activeEditor = this.recipeInstructionsEditor);
                    }

                    this.recipeIngredientsEditor.value(this.editorForm.ingredients || '');
                    this.recipeInstructionsEditor.value(this.editorForm.instructions || '');
                    this.activeEditor = this.recipeIngredientsEditor;

                    this.parseAttachedImages();

                    setTimeout(() => {
                        this.recipeIngredientsEditor.codemirror.refresh();
                        this.recipeInstructionsEditor.codemirror.refresh();
                    }, 200);
                }, 100);
            }
        },

        prepareCreate() {
            this.viewMode = 'create';
            this.editorForm = {
                filename: '',
                oldFilename: null,
                title: '',
                author: '',
                content: '',
                ingredients: '',
                instructions: '',
                fileObj: null,
                mediaPreview: '',
                mediaBase64: '',
                sha: null
            };
            this.mediaError = '';
            this.initEditor();
        },

        async prepareEdit(file) {
            this.viewMode = 'edit';
            this.isLoading = true;

            try {
                let path = `content/${this.currentTab}/${file.name}`;
                if (this.currentTab === 'images') path = `img/photos/${file.name}`;

                if (['images', 'videos'].includes(this.currentTab)) {
                    // For media, we just show the preview, don't download bits again
                    this.editorForm = {
                        filename: file.name,
                        title: '',
                        author: '',
                        content: '',
                        fileObj: null,
                        mediaPreview: file.download_url,
                        mediaBase64: '', // We don't populate this to avoid re-uploading
                        sha: file.sha
                    };
                } else {
                    // Fetch raw text using the GitHub API wrapper so Mock API intercepts it correctly
                    const fileData = await this.api.getFileContent(path);

                    let title = file.name.replace('.md', '').split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                    let author = '';
                    let content = fileData.content;
                    let ingredients = '';
                    let instructions = '';

                    if (this.currentTab === 'quotes') {
                        try {
                            const parsed = JSON.parse(content);
                            author = parsed.author || '';
                            content = parsed.quote || '';
                        } catch (e) { }
                    } else if (this.currentTab === 'recipes') {
                        if (content.includes('<!-- SPLIT -->')) {
                            const parts = content.split('<!-- SPLIT -->');
                            ingredients = parts[0].trim();
                            instructions = parts[1].trim();
                        } else {
                            // Fallback for legacy monolithic recipes
                            ingredients = content;
                            instructions = '';
                        }
                    }

                    this.editorForm = {
                        filename: file.name,
                        oldFilename: null,
                        title: title,
                        author: author,
                        content: content,
                        ingredients: ingredients,
                        instructions: instructions,
                        fileObj: null,
                        mediaPreview: '',
                        mediaBase64: '',
                        sha: fileData.sha
                    };
                    this.initEditor();
                }
            } catch (err) {
                this.showNotification('Failed to load file for editing', 'error');
                this.viewMode = 'list';
            } finally {
                this.isLoading = false;
            }
        },

        handleFileUpload(event) {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            this.mediaError = '';
            this.editorForm.mediaPreviews = [];
            this.editorForm.mediaBase64s = [];
            this.editorForm.filesObj = [];

            files.forEach(file => {

                if (this.currentTab === 'videos') {
                    if (file.type.indexOf('video/') !== 0) {
                        this.mediaError = 'Please selection a valid video file.';
                        return;
                    }

                    // Check 5 second limit length
                    const videoURL = URL.createObjectURL(file);
                    const video = document.createElement('video');

                    video.addEventListener('loadedmetadata', () => {
                        URL.revokeObjectURL(videoURL);
                        if (video.duration > 5.5) { // Adding 0.5s margin of error
                            this.mediaError = `Video is too long (${video.duration.toFixed(1)}s). Max allowed is 5 seconds.`;
                            return;
                        }
                        this.processUploadFile(file);
                    });

                    video.addEventListener('error', () => {
                        this.mediaError = 'Invalid or unsupported video file.';
                    });

                    video.src = videoURL;

                } else {
                    if (file.type.indexOf('image/') !== 0) {
                        this.mediaError = 'Please selection a valid image file.';
                        return;
                    }
                    if (file.size > 10 * 1024 * 1024) {
                        this.mediaError = 'Image exceeds 10MB limit.';
                        return;
                    }
                    this.processUploadFile(file);
                }
            });
        },

        async uploadImageToEditor(event, isThumbnail = false) {
            const file = event.target.files[0];
            if (!file) return;

            if (file.type.indexOf('image/') !== 0) {
                this.showNotification('Please select a valid image file.', 'error');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                this.showNotification('Image exceeds 10MB limit.', 'error');
                return;
            }

            this.isUploadingInEditor = true;
            this.showNotification('Uploading image...', 'success');

            try {
                // Generate safe filename with timestamp
                const cleanName = file.name.replace(/\s+/g, '-').toLowerCase();
                const filename = `${Date.now()}-${cleanName}`;
                // Direct markdown inline uploads to the same active folder
                const path = `img/photos/${filename}`;

                // Read file as Base64 format for API
                const base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                // Trigger save directly to GitHub via API
                await this.api.saveFile(path, base64Data, `Upload inline image: ${filename}`, null, true);

                // Construct relative markdown path based on repo architecture
                const markdownImageSyntax = `\n![${isThumbnail ? "thumbnail" : cleanName}](/img/photos/${filename})\n`;

                // Inject markdown directly at cursor using active SimpleMDE API
                if (this.activeEditor) {
                    const cm = this.activeEditor.codemirror;
                    const doc = cm.getDoc();
                    const cursor = doc.getCursor();
                    doc.replaceRange(markdownImageSyntax, cursor);
                    cm.focus(); // keep focus alive
                } else if (this.editor) { // Fallback to plain editor if no recent focus
                    const cm = this.editor.codemirror;
                    const doc = cm.getDoc();
                    const cursor = doc.getCursor();
                    doc.replaceRange(markdownImageSyntax, cursor);
                    cm.focus();
                } else {
                    this.editorForm.content += markdownImageSyntax;
                }

                this.showNotification('Image inserted successfully!', 'success');

            } catch (err) {
                this.showNotification('Failed to upload image: ' + err.message, 'error');
            } finally {
                this.isUploadingInEditor = false;
                // Clear the input so the same file can be uploaded again if needed
                event.target.value = '';
            }
        },

        processUploadFile(file) {
            this.editorForm.fileObj = file;
            if (!this.editorForm.filename || this.viewMode === 'create') {
                this.editorForm.filename = file.name.replace(/\s+/g, '-').toLowerCase();
            }

            // Read file as Base64 format for GitHub API
            const reader = new FileReader();
            reader.onload = (e) => {
                this.editorForm.mediaPreview = e.target.result;
                const baseData = e.target.result.split(',')[1];
                this.editorForm.mediaBase64 = baseData;

                // Track for multi-file upload save handler
                if (!this.editorForm.mediaBase64s) this.editorForm.mediaBase64s = [];
                this.editorForm.mediaBase64s.push({
                    name: file.name.replace(/\s+/g, '-').toLowerCase(),
                    data: baseData
                });
            };
            reader.readAsDataURL(file);
        },

        async saveContent() {
            // Validation & Auto-generating filenames
            if (['blogs', 'recipes'].includes(this.currentTab)) {
                if (!this.editorForm.title) {
                    this.showNotification('Title is required', 'error');
                    return;
                }
                const generatedFilename = this.editorForm.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
                if (this.viewMode === 'create') {
                    this.editorForm.filename = generatedFilename;
                } else if (this.viewMode === 'edit') {
                    if (this.editorForm.filename !== generatedFilename) {
                        this.editorForm.oldFilename = this.editorForm.filename;
                        this.editorForm.filename = generatedFilename;
                    }
                }
            } else if (this.currentTab === 'quotes') {
                if (!this.editorForm.author || !this.editorForm.content) {
                    this.showNotification('Author Name and Quote Text are required', 'error');
                    return;
                }
                if (this.viewMode === 'create') {
                    this.editorForm.filename = this.editorForm.author.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now() + '.json';
                }
            } else if (['about', 'store'].includes(this.currentTab)) {
                this.editorForm.filename = this.currentTab + '.md';
            } else if (!this.editorForm.filename) {
                this.showNotification('Filename is required', 'error');
                return;
            }

            let finalContent = this.editorForm.content;
            let isBase64 = false;

            if (this.currentTab === 'recipes') {
                const ingContent = this.recipeIngredientsEditor ? this.recipeIngredientsEditor.value() : this.editorForm.ingredients;
                const instContent = this.recipeInstructionsEditor ? this.recipeInstructionsEditor.value() : this.editorForm.instructions;
                if (!ingContent.trim() && !instContent.trim()) {
                    this.showNotification('Content cannot be empty', 'error');
                    return;
                }
                finalContent = ingContent + '\n\n<!-- SPLIT -->\n\n' + instContent;
            } else if (['blogs', 'about', 'store'].includes(this.currentTab)) {
                finalContent = this.editor ? this.editor.value() : this.editorForm.content;
                if (!finalContent.trim()) {
                    this.showNotification('Content cannot be empty', 'error');
                    return;
                }
            }

            if (this.currentTab === 'quotes') {
                finalContent = JSON.stringify({
                    quote: this.editorForm.content,
                    author: this.editorForm.author
                }, null, 2);
            }

            if (['images', 'videos'].includes(this.currentTab)) {
                if (this.viewMode === 'create' && (!this.editorForm.mediaBase64s || this.editorForm.mediaBase64s.length === 0)) {
                    this.showNotification('Please select at least one file to upload', 'error');
                    return;
                }

                if (this.viewMode === 'edit' && (!this.editorForm.mediaBase64s || this.editorForm.mediaBase64s.length === 0)) {
                    this.showNotification('No new file selected to update. To change name, create a new file and delete this one.', 'error');
                    return;
                }

                isBase64 = true;
            }

            this.isSaving = true;

            try {
                if (['images', 'videos'].includes(this.currentTab)) {
                    // Multi-upload handler (Must be sequential to prevent GitHub API 409 tree conflicts)
                    let successCount = 0;
                    for (const media of this.editorForm.mediaBase64s) {
                        // Generate a unique timestamped filename for each to prevent overwriting during batch upload
                        // Use a slight artificial delay for the timestamp just in case loop is too fast
                        await new Promise(r => setTimeout(r, 100));
                        const uniqueFilename = `${Date.now()}-${media.name}`;
                        const path = this.currentTab === 'images' ? `img/photos/${uniqueFilename}` : `content/${this.currentTab}/${uniqueFilename}`;
                        const message = `Upload ${this.currentTab.slice(0, -1)}: ${uniqueFilename}`;

                        await this.api.saveFile(path, media.data, message, null, true);
                        successCount++;
                    }

                    this.showNotification(`Successfully uploaded ${successCount} files!`, 'success');
                    if (this.currentTab === 'images') await this.updateImageManifest();

                } else {
                    // Standard single document save handler (blogs, recipes, quotes, about, store)
                    const path = `content/${this.currentTab}/${this.editorForm.filename}`;
                    const message = `${this.viewMode === 'create' ? 'Create' : 'Update'} ${this.currentTab.slice(0, -1)}: ${this.editorForm.filename}`;

                    // If create mode, verify if file exists first
                    if (this.viewMode === 'create') {
                        const existing = this.contents.find(c => c.name === this.editorForm.filename);
                        if (existing) {
                            this.showNotification('A file with this name already exists', 'error');
                            this.isSaving = false;
                            return;
                        }
                    }

                    // Delete old file if renaming
                    if (this.viewMode === 'edit' && this.editorForm.oldFilename) {
                        try {
                            await this.api.deleteFile(`content/${this.currentTab}/${this.editorForm.oldFilename}`, `Deleting old file due to rename`, this.editorForm.sha);
                            this.editorForm.sha = null; // Next save acts as a create
                            this.editorForm.oldFilename = null;
                            // Clean up local tracking
                            this.contents = this.contents.filter(c => c.name !== this.editorForm.oldFilename);
                        } catch (e) {
                            console.warn('Failed to delete old file during rename:', e.message);
                        }
                    }

                    await this.api.saveFile(path, finalContent, message, this.editorForm.sha, isBase64);
                    this.showNotification(`Successfully ${this.viewMode === 'create' ? 'created' : 'updated'} content`, 'success');
                }

                this.showNotification(`Successfully saved ${this.editorForm.filename}!`);
                this.viewMode = 'list';
                this.loadContents(); // Reload list

            } catch (err) {
                this.showNotification('Failed to save: ' + err.message, 'error');
            } finally {
                this.isSaving = false;
            }
        },

        async deleteFile(file) {
            if (!confirm(`Are you sure you want to delete ${file.name}? This cannot be undone.`)) {
                return;
            }

            this.isDeleting = file.sha;
            let path = `content/${this.currentTab}/${file.name}`;
            if (this.currentTab === 'images') path = `img/photos/${file.name}`;
            const message = `Delete ${this.currentTab.slice(0, -1)}: ${file.name}`;

            try {
                await this.api.deleteFile(path, message, file.sha);
                this.showNotification(`Successfully deleted ${file.name}`);
                this.contents = this.contents.filter(c => c.sha !== file.sha);
                if (this.currentTab === 'images') await this.updateImageManifest();
            } catch (err) {
                this.showNotification('Failed to delete: ' + err.message, 'error');
            } finally {
                this.isDeleting = null;
            }
        },

        parseAttachedImages() {
            let content = '';
            if (this.currentTab === 'recipes') {
                if (this.recipeIngredientsEditor) content += this.recipeIngredientsEditor.value() + '\n';
                if (this.recipeInstructionsEditor) content += this.recipeInstructionsEditor.value();
            } else if (this.editor) {
                content = this.editor.value();
            }
            if (!content) return;

            // Match markdown image syntax: ![alt](url)
            const regex = /!\[.*?\]\((.*?)\)/g;
            const matches = [...content.matchAll(regex)];
            this.attachedImages = matches.map(m => {
                const url = m[1];
                const filename = url.split('/').pop();
                return { url, filename, fullMatch: m[0] };
            });
        },

        async deleteAttachedImage(img) {
            if (!confirm(`Delete ${img.filename} from this post and permanently remove it from the image gallery?`)) return;

            this.isDeletingImage = img.filename;

            try {
                // 1. Remove the image tag from the Markdown editor
                if (this.currentTab === 'recipes') {
                    if (this.recipeIngredientsEditor && this.recipeIngredientsEditor.value().includes(img.fullMatch)) {
                        this.recipeIngredientsEditor.value(this.recipeIngredientsEditor.value().replace(img.fullMatch, ''));
                    }
                    if (this.recipeInstructionsEditor && this.recipeInstructionsEditor.value().includes(img.fullMatch)) {
                        this.recipeInstructionsEditor.value(this.recipeInstructionsEditor.value().replace(img.fullMatch, ''));
                    }
                } else if (this.editor) {
                    const currentContent = this.editor.value();
                    const newContent = currentContent.replace(img.fullMatch, '');
                    this.editor.value(newContent);
                }
                this.parseAttachedImages(); // Refresh the list

                // 2. Delete the physical file from GitHub
                // Try to find the SHA from loaded contents, or fetch it directly
                let sha = null;
                const path = `img/photos/${img.filename}`;
                const fileInState = this.contents.find(c => c.name === img.filename);

                if (fileInState && fileInState.sha) {
                    sha = fileInState.sha;
                } else {
                    try {
                        const fileData = await this.api.getFileContent(path);
                        sha = fileData.sha;
                    } catch (e) { /* File might already be gone */ }
                }

                if (sha) {
                    await this.api.deleteFile(path, `Delete attached image: ${img.filename}`, sha);
                    await this.updateImageManifest();
                    this.showNotification(`Successfully deleted ${img.filename}`, 'success');

                    // Remove from active contents array if it's there
                    this.contents = this.contents.filter(c => c.sha !== sha);
                } else {
                    this.showNotification(`Removed from post. (File not found in gallery)`, 'success');
                }
            } catch (err) {
                this.showNotification('Failed to delete image: ' + err.message, 'error');
            } finally {
                this.isDeletingImage = null;
            }
        },

        async updateImageManifest() {
            try {
                // Fetch current image list from GitHub
                const files = await this.api.getContents('img/photos');
                const names = files
                    .filter(f => f.name !== 'manifest.json' && f.name !== '.gitkeep')
                    .map(f => f.name)
                    .sort((a, b) => b.localeCompare(a)); // newest first
                const content = btoa(JSON.stringify(names, null, 2));
                // Get existing manifest SHA to enable update (not just create)
                let existingSha = null;
                try {
                    const existing = await this.api.request('/repos/{owner}/{repo}/contents/img/photos/manifest.json');
                    existingSha = existing.sha;
                } catch (e) { /* first time — no existing file */ }
                await this.api.saveFile('img/photos/manifest.json', content, 'Update image manifest', existingSha, false);
            } catch (err) {
                console.warn('Could not update manifest.json:', err.message);
            }
        },

        sortImages() {
            if (this.currentTab !== 'images') return;
            switch (this.imageSortOrder) {
                case 'newest':
                    this.contents.sort((a, b) => b.name.localeCompare(a.name));
                    break;
                case 'oldest':
                    this.contents.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case 'az':
                    // Extract original name by skipping the 13-digit timestamp block
                    this.contents.sort((a, b) => {
                        const nameA = a.name.split('-').slice(1).join('-') || a.name;
                        const nameB = b.name.split('-').slice(1).join('-') || b.name;
                        return nameA.localeCompare(nameB);
                    });
                    break;
                case 'za':
                    this.contents.sort((a, b) => {
                        const nameA = a.name.split('-').slice(1).join('-') || a.name;
                        const nameB = b.name.split('-').slice(1).join('-') || b.name;
                        return nameB.localeCompare(nameA);
                    });
                    break;
            }
        },

        async saveImageOrder() {
            if (!confirm('This will permanently update the public gallery to match this exact order. Continue?')) return;
            this.isSavingOrder = true;
            try {
                // Ensure contents are sorted exactly as they appear on screen right now
                this.sortImages();
                const names = this.contents.map(f => f.name);
                const content = btoa(JSON.stringify(names, null, 2));

                let existingSha = null;
                try {
                    const existing = await this.api.request('/repos/{owner}/{repo}/contents/img/photos/manifest.json');
                    existingSha = existing.sha;
                } catch (e) { }

                await this.api.saveFile('img/photos/manifest.json', content, 'Save custom image gallery order', existingSha, false);
                this.showNotification('Gallery order saved successfully!', 'success');
            } catch (err) {
                this.showNotification('Failed to save order: ' + err.message, 'error');
            } finally {
                this.isSavingOrder = false;
            }
        }
    }
}
