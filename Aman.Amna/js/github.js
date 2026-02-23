/**
 * github.js
 * Wrapper for GitHub REST API interactions
 */

const GITHUB_API_URL = 'https://api.github.com';
const REPO_OWNER = 'YOUR_GITHUB_USERNAME'; // This usually will be dynamic, but for now we'll require the user to configure it, or extract from token? 
// Actually since we don't know the exact repo name, we'll prompt the setup.
// Wait, for this project it's a specific repo. The user didn't specify the username/repo in the prompt, so I will fetch it dynamically from the authenticated user or allow configuration.
// Let's create an init function that gets the repo details from the URL if possible or just configuration.
// For github pages, window.location.hostname is username.github.io, and pathname contains /repo/.

class GitHubAPI {
    constructor() {
        this.token = sessionStorage.getItem('gh_token') || null;
        this.owner = localStorage.getItem('gh_owner') || '';
        this.repo = localStorage.getItem('gh_repo') || '';
    }

    setToken(token) {
        this.token = token;
        sessionStorage.setItem('gh_token', token);
    }

    setRepoInfo(owner, repo) {
        this.owner = owner;
        this.repo = repo;
        localStorage.setItem('gh_owner', owner);
        localStorage.setItem('gh_repo', repo);
    }

    clearToken() {
        this.token = null;
        sessionStorage.removeItem('gh_token');
    }

    isAuthenticated() {
        return !!this.token;
    }

    async request(endpoint, method = 'GET', body = null) {
        // Enforce Mock API ONLY for write operations (PUT/DELETE) if no token is present.
        // Publicly visible GET requests should naturally pass through to GitHub unauthenticated.
        if (!this.token && method !== 'GET') {
            // Mock mode for local testing without token
            console.log(`[MOCK API] ${method} ${endpoint}`);

            // Use localforage (IndexedDB) which has virtually unlimited storage compared to 5MB localStorage
            let mockDb = await localforage.getItem('mock_github_db');
            if (!mockDb) {
                // Migrate any old data if present
                const legacy = localStorage.getItem('mock_github_db');
                mockDb = legacy ? JSON.parse(legacy) : {};
                await localforage.setItem('mock_github_db', mockDb);
                localStorage.removeItem('mock_github_db'); // Clean up old 5MB quota
            }

            const match = endpoint.match(/\/contents\/(.*)/);

            if (match) {
                const path = match[1];

                if (method === 'GET') {
                    if (mockDb[path]) {
                        return { content: mockDb[path], sha: 'mock-sha-' + Date.now() };
                    } else {
                        // Directory fetch
                        const files = [];
                        for (const key in mockDb) {
                            if (key.startsWith(path + '/') && key.substring(path.length + 1).indexOf('/') === -1) {
                                files.push({
                                    name: key.split('/').pop(),
                                    type: 'file',
                                    sha: 'mock-sha-' + btoa(key).replace(/=/g, ''),
                                    download_url: mockDb[key].startsWith('data:') ? mockDb[key] :
                                        key.includes('/images/') ? `data:image/jpeg;base64,${mockDb[key]}` :
                                            key.includes('/videos/') ? `data:video/mp4;base64,${mockDb[key]}` : ''
                                });
                            }
                        }
                        return files;
                    }
                } else if (method === 'PUT') {
                    mockDb[path] = body.content;
                    await localforage.setItem('mock_github_db', mockDb);
                    return true;
                } else if (method === 'DELETE') {
                    delete mockDb[path];
                    await localforage.setItem('mock_github_db', mockDb);
                    return true;
                }
            } else if (method === 'GET' && endpoint === '/user') {
                return { login: 'local-test-user' };
            }

            return {};
        }

        // Autodetect repo info if not set (fallback to API)
        if ((!this.owner || !this.repo) && endpoint.includes('{owner}/{repo}')) {
            throw new Error("Repository information is missing. Please configure owner and repo.");
        }

        const url = `${GITHUB_API_URL}${endpoint}`
            .replace('{owner}', this.owner)
            .replace('{repo}', this.repo);

        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers['Authorization'] = `token ${this.token}`;
        }

        const config = {
            method,
            headers
        };

        if (body) {
            config.body = JSON.stringify(body);
        }

        const response = await fetch(url, config);

        if (!response.ok) {
            let errorMsg = `GitHub API Error: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.message || errorMsg;
            } catch (e) { }
            throw new Error(errorMsg);
        }

        // Return null for 204 No Content
        if (response.status === 204 || method === 'DELETE') {
            return true;
        }

        return await response.json();
    }

    // Identify user and get their repos to auto-configure
    async getAuthenticatedUser() {
        return await this.request('/user');
    }

    // List contents of a directory
    async getContents(path) {
        try {
            const data = await this.request(`/repos/{owner}/{repo}/contents/${path}`);
            if (Array.isArray(data)) {
                // Return only actual files, skip .gitkeep and directories
                return data.filter(item => item.type === 'file' && item.name !== '.gitkeep');
            }
            return [data];
        } catch (error) {
            // If the directory doesn't exist, return empty array
            if (error.message.includes('404') || error.message.includes('Not Found')) {
                return [];
            }
            throw error;
        }
    }

    // Fetch raw content of a file
    async getFileContent(path) {
        const data = await this.request(`/repos/{owner}/{repo}/contents/${path}`);

        // Base64 decode content (handling UTF-8 characters properly)
        const decodeBase64 = (str) => {
            try {
                return decodeURIComponent(atob(str).split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
            } catch (e) {
                // Fallback for simple ascii
                return atob(str);
            }
        };

        return {
            ...data,
            sha: data.sha,
            content: decodeBase64(data.content)
        };
    }

    // Create or update a file
    async saveFile(path, content, message, sha = null, isBase64Content = false) {

        // Ensure content is base64 encoded for the GitHub API
        const encodeBase64 = (str) => {
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
                function toSolidBytes(match, p1) {
                    return String.fromCharCode('0x' + p1);
                }));
        };

        const base64Content = isBase64Content ? content : encodeBase64(content);

        const body = {
            message: message,
            content: base64Content
        };

        if (sha) {
            body.sha = sha;
        }

        return await this.request(`/repos/{owner}/{repo}/contents/${path}`, 'PUT', body);
    }

    // Delete a file
    async deleteFile(path, message, sha) {
        const body = {
            message: message,
            sha: sha
        };

        return await this.request(`/repos/{owner}/{repo}/contents/${path}`, 'DELETE', body);
    }
}

// Instantiate globally
window.github = new GitHubAPI();
