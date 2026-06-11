// --- 0. UTILS, MODAL LOCKS, & URL LINKIFIER ---
function sanitize(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function linkify(text) {
    if (!text) return '';
    const urlPattern = /(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" ondragstart="event.preventDefault()" draggable="false" style="color: #0052cc; text-decoration: underline; pointer-events: auto;">$1</a>');
}

function generateUUID() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

let scrollPosition = 0;
function lockBody() { 
    scrollPosition = window.pageYOffset;
    document.body.style.overflow = 'hidden'; 
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollPosition}px`;
    document.body.style.width = '100%';
}
function unlockBody() { 
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('position');
    document.body.style.removeProperty('top');
    document.body.style.removeProperty('width');
    window.scrollTo(0, scrollPosition); 
}

function openCreateWorkspaceModal() { lockBody(); document.getElementById('create-workspace-form').reset(); const m = document.getElementById('create-workspace-modal'); m.showModal(); setTimeout(() => m.scrollTop = 0, 10); }
function closeCreateWorkspaceModal() { unlockBody(); document.getElementById('create-workspace-modal').close(); }

function openAddUserModal() { lockBody(); document.getElementById('add-user-form').reset(); const m = document.getElementById('add-user-modal'); m.showModal(); setTimeout(() => m.scrollTop = 0, 10); }
function closeAddUserModal() { unlockBody(); document.getElementById('add-user-modal').close(); }

function openPromptModal() { lockBody(); document.getElementById('prompt-form').reset(); const m = document.getElementById('prompt-modal'); m.showModal(); setTimeout(() => m.scrollTop = 0, 10); }
function closePromptModal() { unlockBody(); document.getElementById('prompt-modal').close(); }

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';

let workspaces = []; let workspaceUsers = []; let projects = []; let tasks = [];
let currentWorkspaceId = localStorage.getItem('currentWorkspaceId');
let currentProjectId = localStorage.getItem('currentProjectId');

let activeUserEmail = null; let activeUserName = null;

let uiSize = 'auto'; 
let displayConfig = { showDate: true, showUrgency: true, showDesc: true, showAssignee: true };

let currentView = 'active'; let draftTask = null; let draftSubtasks = []; let pendingConfirmAction = null; 
let contextTargetMainId = null; let contextTargetSubtaskId = null; let contextTargetProjectId = null;

// BULK SELECT STATE
let selectedTasks = new Set();
let lastSelectedTaskId = null;

// CHILL CHAT STATE
let messages = [];
let activeChatRecipient = 'team';
let originalAssignees = [];

let isMasterView = false;
let masterTimeframe = 'today';
let masterScope = 'workspace'; 

let activeTimerInterval = null;
let timeLogs = [];
let taskRepetitions = [];
let comments = [];
let chartInstances = {};

const lists = { future: document.getElementById('future-list'), todo: document.getElementById('todo-list'), doing: document.getElementById('doing-list'), done: document.getElementById('done-list'), recurring: document.getElementById('recurring-list'), complete: document.getElementById('complete-list') };
const workspaceContextMenu = document.getElementById('workspace-context-menu'); const activeContextMenu = document.getElementById('active-context-menu'); const futureContextMenu = document.getElementById('future-context-menu'); const archiveContextMenu = document.getElementById('archive-context-menu'); const subtaskContextMenu = document.getElementById('subtask-context-menu');
const projectContextMenu = document.getElementById('project-context-menu');

window.addEventListener('load', async function () {
    await Clerk.load();

    if (Clerk.user) {
        document.getElementById('app-container').style.display = 'block';
        Clerk.mountUserButton(document.getElementById('user-button'));
        
        activeUserEmail = Clerk.user.primaryEmailAddress.emailAddress;
        activeUserName = Clerk.user.fullName || activeUserEmail.split('@')[0];
        
        await loadDataFromDB(); 
        
        let myUser = workspaceUsers.find(u => u.email === activeUserEmail);
        if (!myUser) {
            const newUserId = generateUUID();
            let wsId = currentWorkspaceId;
            
            if (workspaces.length === 0) {
                wsId = generateUUID();
                await apiCall('/workspaces', 'POST', { id: wsId, name: 'Personal Workspace', userId: null, owner_id: newUserId });
                await apiCall('/users', 'POST', { id: newUserId, name: activeUserName, email: activeUserEmail, role: 'Admin', workspace_id: wsId });
            } else {
                if (!wsId || !workspaces.find(w => w.id === wsId)) wsId = workspaces[0].id;
                await apiCall('/users', 'POST', { id: newUserId, name: activeUserName, email: activeUserEmail, role: 'Admin', workspace_id: wsId });
            }
            await loadDataFromDB();
        }

    } else {
        document.getElementById('sign-in-container').style.display = 'flex';
        Clerk.mountSignIn(document.getElementById('sign-in'));
    }

    setInterval(updateGlobalTimer, 1000);
});

// --- CHILL CHAT LOGIC ---
function toggleChatPanel() {
    const panel = document.getElementById('chat-panel');
    const overlay = document.getElementById('chat-overlay');
    if (panel.style.transform === 'translateX(0%)') {
        panel.style.transform = 'translateX(100%)';
        overlay.style.display = 'none';
        unlockBody(); 
    } else {
        panel.style.transform = 'translateX(0%)';
        overlay.style.display = 'block';
        lockBody();  
        populateChatRecipients();
        fetchMessages(); 
    }
}

function populateChatRecipients() {
    const select = document.getElementById('chat-recipient-select');
    select.innerHTML = '<option value="team">Team Chat (Workspace)</option>';
    const me = getActiveUserObj();
    
    getVisibleUsers().forEach(u => {
        if (u.id !== me.id) {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerHTML = `DM: ${sanitize(u.name)}`;
            select.appendChild(opt);
        }
    });
    select.value = activeChatRecipient;
}

function switchChatRecipient(val) {
    activeChatRecipient = val;
    renderChat();
}

async function fetchMessages() {
    if (!currentWorkspaceId) return;
    try {
        const res = await fetch(`${API_URL}/messages/${currentWorkspaceId}`);
        if (res.ok) {
            messages = await res.json();
            renderChat();
        }
        
        const dataRes = await fetch(`${API_URL}/data`);
        if (dataRes.ok) {
            const data = await dataRes.json();
            tasks = (data.tasks || []).map(t => {
                t.assignees = (data.task_assignees || []).filter(ta => ta.task_id === t.id).map(ta => ta.user_id);
                if (t.due_date) t.due_date = t.due_date.split('T')[0];
                t.timer_started_at = t.timer_started_at ? parseInt(t.timer_started_at, 10) : null;
                t.timer_elapsed = t.timer_elapsed ? parseInt(t.timer_elapsed, 10) : 0;
                t.counter = t.counter ? parseInt(t.counter, 10) : 0;
                return t;
            });
            renderAll(); 
        }
    } catch (e) { console.error("Error fetching messages/tasks:", e); }
}

function renderChat() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
        <div style="text-align: center; color: #5e6c84; font-size: 13px; margin-bottom: 20px; padding: 15px; background: #e6fcff; border-radius: 6px; border: 1px dashed #b3d4ff;">
            <strong>Welcome to Chill Chat.</strong><br><br>
            Take the time to think about your message and communicate clearly. Your teammates will get it soonish. 🧘‍♂️
        </div>
    `;
    
    const myId = getActiveUserObj().id;
    
    const filteredMessages = messages.filter(m => {
        if (activeChatRecipient === 'team') {
            return m.recipient_id === null || (m.sender_id === 'system' && m.recipient_id === myId);
        } else {
            return (m.sender_id === myId && m.recipient_id === activeChatRecipient) || 
                   (m.sender_id === activeChatRecipient && m.recipient_id === myId);
        }
    });

    filteredMessages.forEach(msg => {
        const div = document.createElement('div');
        const isMe = msg.sender_id === myId;
        const isSystem = msg.sender_id === 'system' || msg.content.startsWith('🤖 System:');
        
        div.style.maxWidth = '85%';
        div.style.padding = '10px 14px';
        div.style.borderRadius = '8px';
        div.style.fontSize = '14px';
        div.style.lineHeight = '1.4';
        div.style.wordBreak = 'break-word';
        
        if (isSystem) {
            div.style.alignSelf = 'center';
            div.style.background = '#ebecf0';
            div.style.color = '#172b4d';
            div.style.width = '100%';
            div.style.borderLeft = '4px solid #0052cc';
            div.style.boxSizing = 'border-box';
            
            const btnHtml = msg.related_task_id ? `<br><button type="button" class="secondary" style="margin-top: 8px; font-size: 12px; padding: 4px 12px;" onclick="viewTaskFromChat('${msg.related_task_id}')">View Task</button>` : '';
            const cleanContent = msg.content.replace('🤖 System:', '').trim();
            div.innerHTML = `<strong>🤖 System:</strong> ${sanitize(cleanContent)} ${btnHtml}`;
        } else {
            div.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
            div.style.background = isMe ? '#0052cc' : 'white';
            div.style.color = isMe ? 'white' : '#172b4d';
            div.style.border = isMe ? 'none' : '1px solid #dfe1e6';
            
            const senderName = isMe ? 'You' : sanitize(msg.sender_name);
            div.innerHTML = `<div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">${senderName}</div><div>${linkify(sanitize(msg.content))}</div>`;
        }
        container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
}

async function viewTaskFromChat(taskId) {
    toggleChatPanel(); 
    
    let targetTask = tasks.find(t => t.id === taskId);
    
    if (!targetTask) {
        document.getElementById('app-title').innerHTML = "Syncing...";
        await loadDataFromDB(); 
        targetTask = tasks.find(t => t.id === taskId);
    }
    
    if (targetTask) {
        if (currentProjectId !== targetTask.project_id) {
            currentProjectId = targetTask.project_id;
            localStorage.setItem('currentProjectId', currentProjectId);
            renderAll();
        }
        editTask(taskId);
    } else {
        alert("This task has been deleted or you do not have permission to view it.");
    }
}

document.getElementById('chat-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const content = input.value.trim();
    if (!content) return;
    
    const me = getActiveUserObj();
    const recipient = activeChatRecipient === 'team' ? null : activeChatRecipient;
    
    const newMsg = {
        id: generateUUID(),
        workspace_id: currentWorkspaceId,
        sender_id: me.id,
        sender_name: activeUserName,
        recipient_id: recipient,
        content: content,
        related_task_id: null,
        created_at: new Date().toISOString()
    };
    
    messages.push(newMsg);
    renderChat();
    input.value = '';
    
    await apiCall('/messages', 'POST', newMsg);
});

// --- DATA LOGIC ---
async function loadDataFromDB() {
    try {
        document.getElementById('app-title').innerHTML = "Loading...";
        const response = await fetch(`${API_URL}/data`);
        if (!response.ok) throw new Error("API not ready");
        const data = await response.json();
        
        workspaces = data.workspaces || [];
        timeLogs = data.time_logs || [];
        taskRepetitions = data.task_repetitions || [];
        comments = data.comments || [];
        
        projects = (data.projects || []).map(p => { 
            p.isSecret = p.is_secret; 
            return p; 
        });
        
        workspaceUsers = (data.users || []).map(u => {
            const memberships = (data.workspace_members || []).filter(wm => wm.user_id === u.id);
            u.workspace_ids = memberships.map(wm => wm.workspace_id);
            const curr = memberships.find(wm => wm.workspace_id === currentWorkspaceId);
            if (curr) {
                u.role = curr.role;
                u.preferences = curr.preferences || {};
            }
            return u;
        });

        tasks = (data.tasks || []).map(t => {
            t.assignees = (data.task_assignees || []).filter(ta => ta.task_id === t.id).map(ta => ta.user_id);
            if (t.due_date) t.due_date = t.due_date.split('T')[0];
            
            t.timer_started_at = t.timer_started_at ? parseInt(t.timer_started_at, 10) : null;
            t.timer_elapsed = t.timer_elapsed ? parseInt(t.timer_elapsed, 10) : 0;
            t.counter = t.counter ? parseInt(t.counter, 10) : 0;
            
            return t;
        });

        const todayStr = new Date().toISOString().split('T')[0];
        tasks.forEach(t => {
            if (t.status === 'recurring' && t.due_date && t.due_date < todayStr) {
                t.status = 'complete';
                t.completed_at = new Date().toISOString();
                apiCall('/tasks', 'POST', t);
            }
        });

        initValidation();
        renderAll(); 

    } catch (error) { console.error("Database connection failed.", error); }
}

function getActiveUserObj() { 
    let u = workspaceUsers.find(u => u.email === activeUserEmail);
    if (!u) u = { id: null, workspace_ids: [] };
    
    if (!u.preferences) u.preferences = {};
    if (!u.preferences.projectOrder) u.preferences.projectOrder = [];
    if (!u.preferences.uiSize) u.preferences.uiSize = 'auto';
    if (!u.preferences.hiddenProjects) u.preferences.hiddenProjects = []; 
    if (!u.preferences.hiddenTasks) u.preferences.hiddenTasks = [];
    if (!u.preferences.displayConfig) u.preferences.displayConfig = { showDate: true, showUrgency: true, showDesc: true, showAssignee: true };
    
    return u;
}

function initValidation() {
    const me = getActiveUserObj();
    const myWorkspaces = workspaces.filter(ws => me.workspace_ids && me.workspace_ids.includes(ws.id));

    if (myWorkspaces.length > 0 && (!currentWorkspaceId || !myWorkspaces.find(w => w.id === currentWorkspaceId))) {
        currentWorkspaceId = myWorkspaces[0].id; 
        localStorage.setItem('currentWorkspaceId', currentWorkspaceId);
    }
    
    const activeWorkspaceProjects = projects.filter(p => p.workspace_id === currentWorkspaceId);
    if (activeWorkspaceProjects.length > 0) {
        if (!currentProjectId || !activeWorkspaceProjects.find(p => p.id === currentProjectId)) {
            activeWorkspaceProjects.sort((a, b) => {
                let idxA = (me.preferences.projectOrder || []).indexOf(a.id); 
                let idxB = (me.preferences.projectOrder || []).indexOf(b.id);
                if (idxA === -1) idxA = 99999; if (idxB === -1) idxB = 99999; return idxA - idxB;
            });
            currentProjectId = activeWorkspaceProjects[0].id; 
            localStorage.setItem('currentProjectId', currentProjectId);
        }
    } else {
        currentProjectId = null;
    }

    uiSize = me.preferences.uiSize;
    displayConfig = me.preferences.displayConfig;
}

function renderAll() {
    renderWorkspaceMenu(); 
    renderWorkspaceUsers(); 
    renderProjects(); 
    updateAssigneeFilterOptions(); 
    
    if (isMasterView) {
        renderMasterView();
    } else {
        renderBoard();
    }
}

function getVisibleUsers() { return workspaceUsers.filter(u => u.workspace_ids && u.workspace_ids.includes(currentWorkspaceId)); }
function getUserName(id) { const u = workspaceUsers.find(x => x.id === id); return u ? u.name : 'Unknown'; }

async function apiCall(endpoint, method, body = null) {
    try {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        await fetch(`${API_URL}${endpoint}`, options);
    } catch (err) { console.error(`API Error on ${endpoint}:`, err); }
}

async function saveTaskDB(t) {
    const idx = tasks.findIndex(x => x.id === t.id); if (idx > -1) tasks[idx] = t; else tasks.push(t);
    renderAll(); 
    await apiCall('/tasks', 'POST', t);
}

async function silentSaveTaskDB(t) {
    const idx = tasks.findIndex(x => x.id === t.id); if (idx > -1) tasks[idx] = t; else tasks.push(t);
    await apiCall('/tasks', 'POST', t);
}

async function deleteTaskDB(id) {
    tasks = tasks.filter(t => t.id !== id && t.parent_task_id !== id);
    renderAll(); await apiCall(`/tasks/${id}`, 'DELETE');
}

async function saveProjectDB(p) {
    const idx = projects.findIndex(x => x.id === p.id); if (idx > -1) projects[idx] = p; else projects.push(p);
    renderProjects(); await apiCall('/projects', 'POST', p);
}

async function deleteProjectDB(id) {
    projects = projects.filter(p => p.id !== id); tasks = tasks.filter(t => t.project_id !== id);
    if (currentProjectId === id) currentProjectId = projects.filter(p => p.workspace_id === currentWorkspaceId)[0]?.id;
    renderAll(); await apiCall(`/projects/${id}`, 'DELETE');
}

// --- WORKSPACE RENDERS ---
function renderWorkspaceMenu() {
    const list = document.getElementById('workspace-list-menu'); list.innerHTML = '';
    const myWorkspaces = workspaces.filter(ws => getActiveUserObj().workspace_ids.includes(ws.id));
    
    myWorkspaces.forEach(ws => {
        const btn = document.createElement('button');
        btn.innerHTML = ws.id === currentWorkspaceId ? `<strong>✓ ${sanitize(ws.name)}</strong>` : sanitize(ws.name);
        btn.onclick = async () => { 
            currentWorkspaceId = ws.id; localStorage.setItem('currentWorkspaceId', ws.id);
            currentProjectId = null; workspaceContextMenu.style.display = 'none'; 
            clearBulkSelect(); 
            await loadDataFromDB(); 
        };
        list.appendChild(btn);
    });
    const activeWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
    document.getElementById('app-title').innerHTML = activeWorkspace ? sanitize(activeWorkspace.name) : "Task Board";
}

function renderWorkspaceUsers() {
    const settingsList = document.getElementById('settings-user-list'); 
    if(settingsList) {
        settingsList.innerHTML = '';
        const me = getActiveUserObj();
        const isAdmin = me.role === 'Admin';
        
        getVisibleUsers().forEach(u => {
            const div = document.createElement('div'); div.className = 'list-item';
            div.innerHTML = `
                <span class="title" style="display:flex; flex-direction:column; gap:2px;">
                    <span>${sanitize(u.name)} <span class="meta">(${sanitize(u.role || 'Member')})</span></span>
                    <span style="font-size: 10px; color: #8993a4;">${sanitize(u.email)}</span>
                </span>
                <div class="list-actions">
                    ${isAdmin ? `<button type="button" class="edit" style="padding: 2px 6px;" onclick="openEditUserEmailModal('${u.id}', '${sanitize(u.email)}')">✎ Email</button>` : ''}
                    <button type="button" class="danger" style="padding: 2px 6px;" onclick="deleteWorkspaceUser('${u.id}', '${sanitize(u.name)}')" title="Remove User">&times;</button>
                </div>`;
            settingsList.appendChild(div);
        });
    }
}

function openEditUserEmailModal(userId, oldEmail) {
    document.getElementById('settings-modal').close(); 
    document.getElementById('edit-user-email-id').value = userId;
    document.getElementById('edit-user-email-input').value = oldEmail;
    const m = document.getElementById('edit-user-email-modal');
    if(m) m.showModal();
}

function closeEditUserEmailModal() { 
    const m = document.getElementById('edit-user-email-modal');
    if(m) m.close(); 
    document.getElementById('settings-modal').showModal();
}

document.getElementById('edit-user-email-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const userId = document.getElementById('edit-user-email-id').value;
    const newEmail = document.getElementById('edit-user-email-input').value.trim();
    
    await apiCall('/users/email', 'PUT', { id: userId, email: newEmail });
    await loadDataFromDB(); 
    closeEditUserEmailModal(); 
    openSettings(); 
});

function renderProjects() {
    const tabsContainer = document.getElementById('project-tabs'); tabsContainer.innerHTML = '';
    const userPrefs = getActiveUserObj().preferences;
    const myId = getActiveUserObj().id;
    
    let visible = projects.filter(p => p.workspace_id === currentWorkspaceId && (!p.isSecret || p.owner_id === myId) && !(userPrefs.hiddenProjects || []).includes(p.id));
    visible.sort((a, b) => {
        let idxA = userPrefs.projectOrder.indexOf(a.id); let idxB = userPrefs.projectOrder.indexOf(b.id);
        if (idxA === -1) idxA = 99999; if (idxB === -1) idxB = 99999; return idxA - idxB;
    });
    
    visible.forEach(project => {
        const btn = document.createElement('button'); btn.className = `tab ${project.id === currentProjectId ? 'active' : ''}`;
        btn.innerHTML = (project.isSecret ? '🔒 ' : '') + sanitize(project.name);
        
        btn.onclick = () => { 
            if (currentProjectId === project.id) {
                openEditProjectModal(project.id);
            } else {
                currentProjectId = project.id; 
                localStorage.setItem('currentProjectId', project.id);
                clearBulkSelect();
                if(isMasterView) toggleMasterView(); 
                renderBoard(); 
                renderProjects(); 
                updateAssigneeFilterOptions(); 
            }
        };
        
        btn.oncontextmenu = (e) => showContextMenuProject(e, project.id);
        
        btn.draggable = true; 
        btn.ondragstart = (e) => handleTabDragStart(e, project.id); 
        btn.ondragend = (e) => e.target.classList.remove('dragging-tab'); 
        btn.ondragover = (e) => { e.preventDefault(); e.currentTarget.style.background = '#e6fcff'; e.currentTarget.style.borderColor = '#0052cc'; };
        btn.ondragleave = (e) => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = ''; };
        btn.ondrop = (e) => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = ''; handleTabDrop(e, project.id); };
        
        if (project.id === currentProjectId) {
            const delBtn = document.createElement('span'); delBtn.className = 'delete-project'; 
            const isOwner = project.owner_id === myId || !project.owner_id;
            
            delBtn.innerHTML = isOwner ? '&times;' : '🏃'; 
            delBtn.title = isOwner ? "Delete Project" : "Hide Project";
            
            delBtn.onclick = (e) => { 
                e.stopPropagation(); 
                if (isOwner) triggerDeleteProject(project.id); 
                else triggerHideProject(project.id);
            }; 
            btn.appendChild(delBtn);
        }
        tabsContainer.appendChild(btn);
    });
    const addBtn = document.createElement('button'); addBtn.className = 'tab add-new'; addBtn.innerText = '+ Add Project'; addBtn.onclick = () => openPromptModal(); tabsContainer.appendChild(addBtn);
}

function updateAssigneeFilterOptions() {
    const filterSelect = document.getElementById(isMasterView ? 'mv-filter-assignee' : 'filter-assignee'); 
    const currentSelection = filterSelect.value; 
    
    filterSelect.innerHTML = `
        <option value="All">All Assignees</option>
        <option value="Unassigned">Unassigned</option>
        <option value="Removed">Removed / Hidden</option>
        <optgroup label="Specific Users"></optgroup>
    `;
    
    const optGroup = filterSelect.querySelector('optgroup');
    let activeAssignees = new Set(); 
    
    if(isMasterView) {
        const allowedWsIds = getActiveUserObj().workspace_ids || [];
        const allowedProjIds = projects.filter(p => allowedWsIds.includes(p.workspace_id)).map(p => p.id);
        tasks.filter(t => allowedProjIds.includes(t.project_id)).forEach(t => { if (t.assignees) t.assignees.forEach(a => activeAssignees.add(a)); });
    } else {
        tasks.filter(t => t.project_id === currentProjectId).forEach(t => { if (t.assignees) t.assignees.forEach(a => activeAssignees.add(a)); });
    }

    Array.from(activeAssignees).sort().forEach(id => { 
        const option = document.createElement('option'); option.value = id; 
        option.innerHTML = sanitize(getUserName(id)); 
        optGroup.appendChild(option); 
    });
    if (currentSelection) filterSelect.value = currentSelection;
}

// --- BULK ACTION ENGINE ---
function toggleBulkSelect(taskId, isChecked) {
    if(isChecked) selectedTasks.add(taskId);
    else selectedTasks.delete(taskId);
    renderBulkActionBar();
}

function clearBulkSelect() {
    selectedTasks.clear();
    renderBoard(); 
    renderBulkActionBar();
}

function renderBulkActionBar() {
    let bar = document.getElementById('bulk-action-bar');
    if(!bar) {
        bar = document.createElement('div');
        bar.id = 'bulk-action-bar';
        bar.style.position = 'fixed';
        bar.style.bottom = '20px';
        bar.style.left = '50%';
        bar.style.transform = 'translateX(-50%)';
        bar.style.background = '#172b4d';
        bar.style.color = 'white';
        bar.style.padding = '12px 24px';
        bar.style.borderRadius = '8px';
        bar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.gap = '15px';
        bar.style.zIndex = '9999';
        document.body.appendChild(bar);
    }
    
    if(selectedTasks.size === 0) {
        bar.style.display = 'none';
        return;
    }
    
    bar.style.display = 'flex';
    bar.innerHTML = `
        <span style="font-weight:bold;">${selectedTasks.size} task(s) selected</span>
        <select id="bulk-status-select" style="padding:6px 12px; border-radius:4px; color:black; font-family:inherit;">
            <option value="" disabled selected>Move selected to...</option>
            <option value="todo">To Do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
            <option value="future">Future</option>
            <option value="recurring">Recurring</option>
            <option value="complete">Archive (Complete)</option>
        </select>
        <button type="button" class="action-success" onclick="executeBulkMove()" style="padding:6px 16px;">Apply Status</button>
        <button type="button" class="danger" onclick="executeBulkDelete()" style="padding:6px 16px;">Delete All</button>
        <button type="button" class="secondary" onclick="clearBulkSelect()" style="padding:6px 16px; background:transparent; color:white; border: 1px solid white;">Cancel</button>
    `;
}

async function executeBulkMove() {
    const status = document.getElementById('bulk-status-select').value;
    if(!status) return;
    
    for(let id of selectedTasks) {
        const t = tasks.find(x => x.id === id);
        if(t) {
            const oldStatus = t.status;
            t.status = status;
            
            if ((status === 'done' || status === 'complete' || status === 'archive') && (oldStatus !== 'done' && oldStatus !== 'complete' && oldStatus !== 'archive')) {
                t.completed_at = new Date().toISOString();
                if (t.timer_running) {
                    const now = Date.now();
                    const start = parseInt(t.timer_started_at, 10) || now;
                    t.timer_elapsed = parseInt(t.timer_elapsed, 10) + (now - start);
                    t.timer_running = false;
                    t.timer_started_at = null;
                }
            } else if (status !== 'done' && status !== 'complete' && status !== 'archive') {
                t.completed_at = null;
            }
            
            const idx = tasks.findIndex(x => x.id === id); 
            if (idx > -1) tasks[idx] = t;
            apiCall('/tasks', 'POST', t); 
        }
    }
    selectedTasks.clear();
    renderBulkActionBar();
    renderAll();
}

function executeBulkDelete() {
    if(!confirm(`Are you sure you want to permanently delete ${selectedTasks.size} task(s)? This cannot be undone.`)) return;
    
    for(let id of selectedTasks) {
        tasks = tasks.filter(t => t.id !== id && t.parent_task_id !== id);
        apiCall('/tasks/' + id, 'DELETE');
    }
    selectedTasks.clear();
    renderBulkActionBar();
    renderAll();
}

function handleCardClick(e, id) {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); e.stopPropagation();
        if (selectedTasks.has(id)) selectedTasks.delete(id);
        else selectedTasks.add(id);
        lastSelectedTaskId = id;
        renderBoard(); 
        return;
    } else if (e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        if (lastSelectedTaskId) {
            const t1 = tasks.find(x => x.id === lastSelectedTaskId);
            const t2 = tasks.find(x => x.id === id);
            
            if (t1 && t2 && t1.status === t2.status) {
                const list = document.getElementById(t1.status + '-list');
                const cards = Array.from(list.querySelectorAll('.card')).map(c => c.getAttribute('data-id'));
                const idx1 = cards.indexOf(lastSelectedTaskId);
                const idx2 = cards.indexOf(id);
                if (idx1 > -1 && idx2 > -1) {
                    const start = Math.min(idx1, idx2);
                    const end = Math.max(idx1, idx2);
                    for (let i = start; i <= end; i++) {
                        selectedTasks.add(cards[i]);
                    }
                }
            } else {
                selectedTasks.add(id);
            }
        } else {
            selectedTasks.add(id);
        }
        lastSelectedTaskId = id;
        renderBoard();
        return;
    }
    
    selectedTasks.clear();
    lastSelectedTaskId = id;
    editTask(id);
}

async function contextActionBulkMoveTo(status) {
    closeMenus();
    for (let id of selectedTasks) {
        const t = tasks.find(x => x.id === id);
        if (t) {
            const oldStatus = t.status;
            t.status = status;
            
            if ((status === 'done' || status === 'complete' || status === 'archive') && (oldStatus !== 'done' && oldStatus !== 'complete' && oldStatus !== 'archive')) {
                t.completed_at = new Date().toISOString();
                if (t.timer_running) {
                    const now = Date.now();
                    const start = parseInt(t.timer_started_at, 10) || now;
                    t.timer_elapsed = parseInt(t.timer_elapsed, 10) + (now - start);
                    t.timer_running = false;
                    t.timer_started_at = null;
                }
            } else if (status !== 'done' && status !== 'complete' && status !== 'archive') {
                t.completed_at = null;
            }
            
            const idx = tasks.findIndex(x => x.id === id); 
            if (idx > -1) tasks[idx] = t;
            apiCall('/tasks', 'POST', t); 
        }
    }
    selectedTasks.clear();
    renderAll();
}

function contextActionBulkDelete() {
    closeMenus();
    if(!confirm(`Are you sure you want to permanently delete ${selectedTasks.size} tasks? This cannot be undone.`)) return;
    
    for (let id of selectedTasks) {
        tasks = tasks.filter(t => t.id !== id && t.parent_task_id !== id);
        apiCall('/tasks/' + id, 'DELETE');
    }
    selectedTasks.clear();
    renderAll();
}

function contextActionMoveToProject(projId) {
    closeMenus();
    let tasksToMove = selectedTasks.size > 0 ? Array.from(selectedTasks) : [contextTargetMainId];
    tasksToMove.forEach(id => {
        const t = tasks.find(x => x.id === id);
        if(t) {
            t.project_id = projId;
            apiCall('/tasks', 'POST', t);
        }
    });
    selectedTasks.clear();
    renderAll();
}

function handleCardAction(e, action, id, param) {
    e.preventDefault();
    e.stopPropagation();
    if (action === 'delete') triggerDeleteTask(id);
    else if (action === 'edit') editTask(id);
    else if (action === 'move') moveTaskStatus(id, param);
    else if (action === 'menu') showContextMenuMain(e, id);
    else if (action === 'inline-counter-minus') inlineAdjustCounter(id, -1);
    else if (action === 'inline-counter-plus') inlineAdjustCounter(id, 1);
    else if (action === 'remove-me') triggerRemoveMeTask(id); 
}

function renderBoard() {
    lists.future.innerHTML = ''; lists.todo.innerHTML = ''; lists.doing.innerHTML = ''; lists.done.innerHTML = ''; lists.recurring.innerHTML = ''; lists.complete.innerHTML = '';
    const searchQ = document.getElementById('filter-search').value.toLowerCase(); const assigneeQ = document.getElementById('filter-assignee').value; const urgencyQ = document.getElementById('filter-urgency').value;
    const activeMainTasks = tasks.filter(task => task.project_id === currentProjectId && task.parent_task_id === null);
    
    const userPrefs = getActiveUserObj().preferences;
    const hiddenTasks = userPrefs.hiddenTasks || [];
    const meId = getActiveUserObj().id;
    
    const allMatches = activeMainTasks.filter(task => {
        const titleStr = (task.title || '').toLowerCase(); 
        const descStr = (task.description || '').toLowerCase(); 
        const urgencyStr = (task.urgency || ''); 
        const assigneesArray = task.assignees || [];
        
        if (!(titleStr.includes(searchQ) || descStr.includes(searchQ))) return false;
        if (urgencyQ !== "All" && urgencyStr !== urgencyQ) return false;
        
        const isActuallyHidden = hiddenTasks.includes(task.id) && !assigneesArray.includes(meId);
        
        if (assigneeQ === "All") {
            return !isActuallyHidden;
        } else if (assigneeQ === "Unassigned") {
            return !isActuallyHidden && assigneesArray.length === 0;
        } else if (assigneeQ === "Removed") {
            return isActuallyHidden; 
        } else {
            return assigneesArray.includes(assigneeQ) && !isActuallyHidden;
        }
    });

    const taskOrder = userPrefs.taskOrder || [];
    allMatches.sort((a, b) => {
        let idxA = taskOrder.indexOf(a.id);
        let idxB = taskOrder.indexOf(b.id);
        if (idxA === -1) idxA = 99999;
        if (idxB === -1) idxB = 99999;
        return idxA - idxB;
    });

    if (searchQ || assigneeQ !== 'All' || urgencyQ !== 'All') {
        const aHits = allMatches.filter(t => ['todo', 'doing', 'done'].includes(t.status)).length; 
        const fHits = allMatches.filter(t => t.status === 'future').length; 
        const cHits = allMatches.filter(t => t.status === 'complete').length;
        const rHits = allMatches.filter(t => t.status === 'recurring').length;
        
        document.getElementById('btn-view-active').innerHTML = `📊 Active ${aHits > 0 ? `<span class="search-badge">${aHits}</span>` : ''}`; 
        document.getElementById('btn-view-recurring').innerHTML = `Recurring ${rHits > 0 ? `<span class="search-badge">${rHits}</span>` : ''}`; 
        document.getElementById('btn-view-future').innerHTML = `Future ${fHits > 0 ? `<span class="search-badge">${fHits}</span>` : ''}`; 
        document.getElementById('btn-view-archive').innerHTML = `Archive ${cHits > 0 ? `<span class="search-badge">${cHits}</span>` : ''}`;
    } else {
        document.getElementById('btn-view-active').innerHTML = `📊 Active`; 
        document.getElementById('btn-view-recurring').innerHTML = `Recurring`; 
        document.getElementById('btn-view-future').innerHTML = `Future`; 
        document.getElementById('btn-view-archive').innerHTML = `Archive`;
    }

    let activeSize = uiSize;
    if (uiSize === 'auto') {
        const counts = { todo: 0, doing: 0, done: 0 }; activeMainTasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });
        let maxCount = currentView === 'active' ? Math.max(counts.todo, counts.doing, counts.done) : 0;
        if (maxCount >= 7) activeSize = 'small'; else if (maxCount >= 4) activeSize = 'medium'; else activeSize = 'big';
    }
    document.getElementById('master-board-wrapper').className = `board-container size-${activeSize}`;
    
    allMatches.forEach(task => {
        const isCreator = task.creator_id === meId || !task.creator_id;
        const isActuallyHidden = hiddenTasks.includes(task.id) && !(task.assignees || []).includes(meId);
        
        const removeOrUnhideBtn = isCreator 
            ? `<button type="button" class="danger" onclick="handleCardAction(event, 'delete', '${task.id}')" title="Delete">&times;</button>`
            : (isActuallyHidden 
                ? `<button type="button" class="action-warning" onclick="event.stopPropagation(); triggerUnhideTask('${task.id}')" title="Restore Task to Board">👁️</button>`
                : `<button type="button" class="danger" onclick="handleCardAction(event, 'remove-me', '${task.id}')" title="Hide/Remove Me">🏃</button>`
              );
              
        let desktopActions = '';
        if (['todo', 'doing', 'done', 'recurring'].includes(task.status)) { 
            desktopActions = `
                <button type="button" class="action-success" onclick="handleCardAction(event, 'move', '${task.id}', 'complete')" title="Archive">✓</button> 
                <button type="button" class="edit" onclick="handleCardAction(event, 'edit', '${task.id}')" title="Edit">✎</button> 
                ${removeOrUnhideBtn}`; 
        } 
        else if (task.status === 'future') { 
            desktopActions = `
                <button type="button" class="action-primary" onclick="handleCardAction(event, 'move', '${task.id}', 'todo')" title="Move to Active Board">🚀</button> 
                <button type="button" class="edit" onclick="handleCardAction(event, 'edit', '${task.id}')" title="Edit">✎</button> 
                ${removeOrUnhideBtn}`; 
        } 
        else if (task.status === 'complete') { 
            desktopActions = `
                <button type="button" class="action-warning" onclick="handleCardAction(event, 'move', '${task.id}', 'done')" title="Restore to Board">⏪</button> 
                <button type="button" class="edit" onclick="handleCardAction(event, 'edit', '${task.id}')" title="Edit">✎</button> 
                ${removeOrUnhideBtn}`; 
        }
        
        const card = document.createElement('div'); card.className = 'card'; card.setAttribute('data-id', task.id); card.draggable = true;
        card.ondragstart = (e) => dragStart(e, task.id); card.ondragend = (e) => dragEnd(e); 
        
        card.setAttribute('onclick', `handleCardClick(event, '${task.id}')`); 
        card.setAttribute('oncontextmenu', `showContextMenuMain(event, '${task.id}')`);
        
        if (selectedTasks.has(task.id)) {
            card.style.outline = '2px solid #0052cc';
            card.style.backgroundColor = '#e6fcff';
        }
        
        const urgencyHtml = displayConfig.showUrgency ? `<span class="dot ${task.urgency}" title="Urgency: ${task.urgency}"></span>` : ''; 
        const descHtml = (displayConfig.showDesc && task.description) ? `<p>${linkify(sanitize(task.description))}</p>` : '';
        
        let assigneesHtml = ''; 
        if (displayConfig.showAssignee) { 
            const aList = task.assignees || []; 
            if (aList.length === 0) assigneesHtml = `<span class="badge" style="background:#dfe1e6; color:#42526e;">Unassigned</span>`; 
            else assigneesHtml = aList.map(id => `<span class="badge">👤 ${sanitize(getUserName(id))}</span>`).join(''); 
        }
        
        let dateHtml = ''; if (displayConfig.showDate && task.due_date) { const d = new Date(task.due_date + 'T12:00:00'); dateHtml = `<span class="date-badge" title="Due Date">📅 ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`; }
        const childTasks = tasks.filter(t => t.parent_task_id === task.id); let subtaskHtml = ''; if (childTasks.length > 0) { subtaskHtml = `<span class="badge subtask-badge" title="Subtasks">☑ ${childTasks.filter(s => s.status === 'complete').length}/${childTasks.length}</span>`; }
        
        let recurringCounterHtml = '';
        if (task.status === 'recurring') {
            const count = task.counter || 0;
            recurringCounterHtml = `
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #dfe1e6;" onclick="event.stopPropagation()">
                    <span style="font-size: 11px; color: #5e6c84; font-weight: bold; text-transform: uppercase;">Repetitions:</span>
                    <button type="button" class="secondary" style="padding: 2px 10px; font-size: 14px; border-radius: 12px; height: 24px; display: flex; align-items: center;" onclick="handleCardAction(event, 'inline-counter-minus', '${task.id}')">-</button>
                    <span class="inline-counter-val-${task.id}" style="font-weight: bold; font-size: 14px; min-width: 24px; text-align: center; color: #0052cc; text-decoration: underline; cursor: pointer;" onclick="event.stopPropagation(); openRepetitionReportModal('${task.id}')" title="View Repetition History">${count}</span>
                    <button type="button" class="secondary" style="padding: 2px 10px; font-size: 14px; border-radius: 12px; height: 24px; display: flex; align-items: center;" onclick="handleCardAction(event, 'inline-counter-plus', '${task.id}')">+</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="card-header-row" style="align-items: center; justify-content: flex-start; gap: 8px;">
                <h3 style="margin: 0; flex: 1; display:flex; align-items:center; gap:6px;">${urgencyHtml} ${sanitize(task.title)}</h3>
                <button type="button" class="card-menu-btn" onclick="handleCardAction(event, 'menu', '${task.id}')">⋮</button>
            </div>
            ${descHtml}
            ${recurringCounterHtml}
            <div class="card-footer">
                <div class="meta-group">${assigneesHtml}${dateHtml}${subtaskHtml}</div>
                <div class="actions">${desktopActions}</div>
            </div>`; 
        (lists[task.status] || lists.todo).appendChild(card);
    });

    if (window.innerWidth <= 768 && (searchQ || assigneeQ !== 'All' || urgencyQ !== 'All') && currentView === 'active') {
        const firstPopulated = [
            { list: lists.todo, col: lists.todo.parentElement },
            { list: lists.doing, col: lists.doing.parentElement },
            { list: lists.done, col: lists.done.parentElement }
        ].find(item => item.list.children.length > 0);

        if (firstPopulated) {
            firstPopulated.col.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        }
    }
}

async function navigateToProject(wsId, projId) {
    if (!wsId || !projId) return;
    if (currentWorkspaceId !== wsId) {
        currentWorkspaceId = wsId;
        localStorage.setItem('currentWorkspaceId', wsId);
        await loadDataFromDB(); 
    } 
    
    currentProjectId = projId;
    localStorage.setItem('currentProjectId', projId);
    
    clearBulkSelect();
    
    if (isMasterView) toggleMasterView();
    else renderAll();
}

function setMasterTime(time) {
    masterTimeframe = time;
    document.getElementById('mv-time-today').classList.toggle('active', time === 'today');
    document.getElementById('mv-time-week').classList.toggle('active', time === 'week');
    renderMasterView();
}

function setMasterScope(scope) {
    masterScope = scope;
    document.getElementById('mv-scope-project').classList.toggle('active-blue', scope === 'project');
    document.getElementById('mv-scope-workspace').classList.toggle('active-blue', scope === 'workspace');
    document.getElementById('mv-scope-all').classList.toggle('active-blue', scope === 'all');
    updateAssigneeFilterOptions();
    renderMasterView();
}

function toggleStatusDropdown(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropdown = document.getElementById('mv-status-dropdown');
    const isCurrentlyOpen = dropdown.style.display === 'block';
    closeMenus(); 
    dropdown.style.display = isCurrentlyOpen ? 'none' : 'block';
}

function toggleMasterView() {
    isMasterView = !isMasterView;
    document.getElementById('kanban-view-container').style.display = isMasterView ? 'none' : 'block';
    document.getElementById('master-schedule-container').style.display = isMasterView ? 'block' : 'none';

    if (isMasterView) {
        updateAssigneeFilterOptions();
        renderMasterView();
    } else {
        updateAssigneeFilterOptions();
        renderBoard();
    }
}

function renderMasterView() {
    const list = document.getElementById('master-task-list');
    list.innerHTML = '';

    const searchQ = document.getElementById('mv-filter-search').value.toLowerCase();
    const assigneeQ = document.getElementById('mv-filter-assignee').value;
    const urgencyQ = document.getElementById('mv-filter-urgency').value;

    const today = new Date();
    today.setHours(0,0,0,0);

    const activeStatuses = Array.from(document.querySelectorAll('.mv-status-check:checked')).map(cb => cb.value);
    let scopedTasks = tasks.filter(t => t.parent_task_id === null && activeStatuses.includes(t.status));

    if (masterScope === 'project') {
        scopedTasks = scopedTasks.filter(t => t.project_id === currentProjectId);
    } else if (masterScope === 'workspace') {
        const wsProjectIds = projects.filter(p => p.workspace_id === currentWorkspaceId).map(p => p.id);
        scopedTasks = scopedTasks.filter(t => wsProjectIds.includes(t.project_id));
    } else {
        const allowedWsIds = getActiveUserObj().workspace_ids || [];
        const allowedProjIds = projects.filter(p => allowedWsIds.includes(p.workspace_id)).map(p => p.id);
        scopedTasks = scopedTasks.filter(t => allowedProjIds.includes(t.project_id));
    }

    const userPrefs = getActiveUserObj().preferences;
    const hiddenTasks = userPrefs.hiddenTasks || [];
    const meId = getActiveUserObj().id;

    let timeFiltered = scopedTasks.filter(t => {
        if (!t.due_date) return false;

        const [y, m, d] = t.due_date.split('-');
        const taskDate = new Date(y, m - 1, d);
        taskDate.setHours(0,0,0,0);

        const diffTime = taskDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (masterTimeframe === 'today') return diffDays <= 0; 
        if (masterTimeframe === 'week') return diffDays <= 7;
        return true;
    });

    let finalMatches = timeFiltered.filter(task => {
        const titleStr = (task.title || '').toLowerCase();
        const descStr = (task.description || '').toLowerCase();
        const urgencyStr = (task.urgency || '');
        const assigneesArray = task.assignees || [];
        
        if (!(titleStr.includes(searchQ) || descStr.includes(searchQ))) return false;
        if (urgencyQ !== "All" && urgencyStr !== urgencyQ) return false;
        
        const isActuallyHidden = hiddenTasks.includes(task.id) && !assigneesArray.includes(meId);
        
        if (assigneeQ === "All") {
            return !isActuallyHidden;
        } else if (assigneeQ === "Unassigned") {
            return !isActuallyHidden && assigneesArray.length === 0;
        } else if (assigneeQ === "Removed") {
            return isActuallyHidden; 
        } else {
            return assigneesArray.includes(assigneeQ) && !isActuallyHidden;
        }
    });

    finalMatches.sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
    });

    if (finalMatches.length === 0) {
        list.innerHTML = `<div style="padding: 40px 20px; color: #5e6c84; font-size: 16px; text-align: center; width: 100%;">You have no tasks scheduled for this timeframe. Enjoy your free time! 🎉</div>`;
        return;
    }

    finalMatches.forEach(task => {
        const card = document.createElement('div'); 
        card.className = 'card'; 
        card.setAttribute('data-id', task.id); 
        
        card.setAttribute('onclick', `handleCardClick(event, '${task.id}')`); 
        card.setAttribute('oncontextmenu', `showContextMenuMain(event, '${task.id}')`);
        
        if (selectedTasks.has(task.id)) {
            card.style.outline = '2px solid #0052cc';
            card.style.backgroundColor = '#e6fcff';
        }
        
        const proj = projects.find(p => p.id === task.project_id);
        const ws = workspaces.find(w => w.id === (proj ? proj.workspace_id : null));
        
        const contextHtml = `<div class="context-crumb clickable-crumb" onclick="event.stopPropagation(); navigateToProject('${ws ? ws.id : ''}', '${proj ? proj.id : ''}')">${sanitize(ws ? ws.name : '')} › ${sanitize(proj ? proj.name : '')}</div>`;

        const urgencyHtml = displayConfig.showUrgency ? `<span class="dot ${task.urgency}" title="Urgency: ${task.urgency}"></span>` : ''; 

        let dateHtml = ''; 
        if (task.due_date) { 
            const d = new Date(task.due_date + 'T12:00:00'); 
            dateHtml = `<span class="date-badge" style="margin:0; background: transparent; border: none; padding: 0;">📅 ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`; 
        }

        let recurringCounterHtml = '';
        if (task.status === 'recurring') {
            const count = task.counter || 0;
            recurringCounterHtml = `
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #dfe1e6;" onclick="event.stopPropagation()">
                    <span style="font-size: 11px; color: #5e6c84; font-weight: bold; text-transform: uppercase;">Repetitions:</span>
                    <button type="button" class="secondary" style="padding: 2px 10px; font-size: 14px; border-radius: 12px; height: 24px; display: flex; align-items: center;" onclick="handleCardAction(event, 'inline-counter-minus', '${task.id}')">-</button>
                    <span class="inline-counter-val-${task.id}" style="font-weight: bold; font-size: 14px; min-width: 24px; text-align: center; color: #0052cc; text-decoration: underline; cursor: pointer;" onclick="event.stopPropagation(); openRepetitionReportModal('${task.id}')" title="View Repetition History">${count}</span>
                    <button type="button" class="secondary" style="padding: 2px 10px; font-size: 14px; border-radius: 12px; height: 24px; display: flex; align-items: center;" onclick="handleCardAction(event, 'inline-counter-plus', '${task.id}')">+</button>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div style="padding: 8px 12px;">
                ${contextHtml}
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                    <h3 style="font-size: 14px; margin: 0; color: #172b4d; flex: 1; display: flex; align-items: center; gap: 6px;">${urgencyHtml} ${sanitize(task.title)}</h3>
                    ${dateHtml}
                </div>
                ${recurringCounterHtml}
            </div>`; 
        list.appendChild(card);
    });
}

function openSettings() {
    lockBody();
    const prefs = getActiveUserObj().preferences;
    document.getElementById('setting-task-size').value = prefs.uiSize;
    document.getElementById('setting-show-date').checked = prefs.displayConfig.showDate !== false;
    document.getElementById('setting-show-urgency').checked = prefs.displayConfig.showUrgency !== false;
    document.getElementById('setting-show-desc').checked = prefs.displayConfig.showDesc !== false;
    document.getElementById('setting-show-assignee').checked = prefs.displayConfig.showAssignee !== false;
    
    renderWorkspaceUsers();
    const m = document.getElementById('settings-modal');
    m.showModal();
    setTimeout(() => m.scrollTop = 0, 10);
}

function closeSettings() { unlockBody(); document.getElementById('settings-modal').close(); }

async function saveSettings() {
    const user = getActiveUserObj();
    if (!user || !user.id) { closeSettings(); return; }
    
    user.preferences.uiSize = document.getElementById('setting-task-size').value;
    user.preferences.displayConfig = { 
        showDate: document.getElementById('setting-show-date').checked, 
        showUrgency: document.getElementById('setting-show-urgency').checked, 
        showDesc: document.getElementById('setting-show-desc').checked, 
        showAssignee: document.getElementById('setting-show-assignee').checked 
    }; 
    uiSize = user.preferences.uiSize; displayConfig = user.preferences.displayConfig; 
    
    closeSettings(); 
    await apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: user.id, preferences: user.preferences });
    renderAll(); 
}

function openFeedbackModal(type) {
    lockBody(); 
    document.getElementById('feedback-form').reset();
    document.getElementById('feedback-type').value = type;
    document.getElementById('feedback-title').innerText = type === 'bug' ? 'Report a Bug' : 'Request a Feature';
    const m = document.getElementById('feedback-modal');
    m.showModal();
}

function closeFeedbackModal() { 
    document.getElementById('feedback-modal').close(); 
}

document.getElementById('feedback-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const type = document.getElementById('feedback-type').value;
    const title = document.getElementById('feedback-subject').value;
    const desc = document.getElementById('feedback-desc').value;
    
    await apiCall('/feedback', 'POST', {
        id: generateUUID(),
        user_id: getActiveUserObj().id,
        type: type,
        title: title,
        description: desc
    });
    
    closeFeedbackModal();
    alert("Thank you for your feedback!");
});

function switchView(v) {
    currentView = v;
    document.getElementById('btn-view-active').classList.toggle('active', v === 'active'); 
    document.getElementById('btn-view-recurring').classList.toggle('active', v === 'recurring'); 
    document.getElementById('btn-view-future').classList.toggle('active', v === 'future'); 
    document.getElementById('btn-view-archive').classList.toggle('active', v === 'archive');
    
    document.getElementById('view-active').style.display = (v === 'active') ? 'flex' : 'none'; 
    document.getElementById('view-recurring').style.display = (v === 'recurring') ? 'block' : 'none'; 
    document.getElementById('view-future').style.display = (v === 'future') ? 'block' : 'none'; 
    document.getElementById('view-archive').style.display = (v === 'archive') ? 'block' : 'none';
    
    clearBulkSelect();
    renderBoard();
}

function toggleWorkspaceMenu(e) { 
    e.preventDefault(); e.stopPropagation(); closeMenus(); 
    const menu = document.getElementById('workspace-context-menu');
    
    const ws = workspaces.find(w => w.id === currentWorkspaceId);
    const me = getActiveUserObj();
    const delBtn = document.getElementById('workspace-delete-btn');
    if (delBtn) {
        if (ws && (ws.owner_id === me.id || !ws.owner_id)) {
            delBtn.innerHTML = '✕ Delete Current Workspace';
        } else {
            delBtn.innerHTML = '🏃 Leave Current Workspace';
        }
    }
    
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block'; 
}

document.addEventListener('click', (e) => { 
    closeMenus(); 
    if (!e.target.closest('.card') && !e.target.closest('.custom-context-menu') && selectedTasks.size > 0) {
        selectedTasks.clear();
        renderBoard();
    }
    
    // Auto-close UI Pills when clicking away
    if (!e.target.closest('#pill-urgency') && !e.target.closest('#urgency-dropdown')) {
        const d = document.getElementById('urgency-dropdown');
        if (d) d.style.display = 'none';
    }
    if (!e.target.closest('#pill-status') && !e.target.closest('#status-dropdown')) {
        const d = document.getElementById('status-dropdown');
        if (d) d.style.display = 'none';
    }
});

function closeMenus() { 
    activeContextMenu.style.display = 'none'; 
    futureContextMenu.style.display = 'none'; 
    archiveContextMenu.style.display = 'none'; 
    subtaskContextMenu.style.display = 'none'; 
    workspaceContextMenu.style.display = 'none'; 
    if(projectContextMenu) projectContextMenu.style.display = 'none'; 
    const statusDropdown = document.getElementById('mv-status-dropdown');
    if(statusDropdown) statusDropdown.style.display = 'none';
}

function positionMenu(e, target) {
    if (window.innerWidth > 768) {
        let x = e.pageX;
        let y = e.pageY;
        
        if (e.clientY + target.offsetHeight > window.innerHeight) {
            y = e.pageY - target.offsetHeight;
        }
        if (e.clientX + target.offsetWidth > window.innerWidth) {
            x = e.pageX - target.offsetWidth;
        }
        
        target.style.left = x + 'px'; 
        target.style.top = y + 'px'; 
    }
}

// --- CONTEXT MENUS & ACCORDIONS ---
function toggleContextSubmenu(e, id) {
    e.preventDefault(); e.stopPropagation();
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function showContextMenuMain(e, id) { 
    e.preventDefault(); e.stopPropagation(); closeMenus(); 
    contextTargetMainId = id; 
    
    if (!selectedTasks.has(id)) {
        selectedTasks.clear();
        selectedTasks.add(id);
        lastSelectedTaskId = id;
        renderBoard(); 
    }
    
    let target;
    const count = selectedTasks.size;
    
    const me = getActiveUserObj();
    let visibleProjs = projects.filter(p => p.workspace_id === currentWorkspaceId && (!p.isSecret || p.owner_id === me.id) && !(me.preferences.hiddenProjects || []).includes(p.id) && p.id !== currentProjectId);
    
    let projectOptionsHtml = '';
    if (visibleProjs.length > 0) {
        projectOptionsHtml = `
            <div style="margin-top: 8px; border-top: 1px solid #dfe1e6; padding-top: 8px;"></div>
            <button onclick="toggleContextSubmenu(event, 'submenu-projects')" style="color: #42526e; display: flex; justify-content: space-between; align-items: center; width: 100%; padding-right: 8px;">
                <span>📁 Move to Project</span>
                <span style="font-size: 10px;">▼</span>
            </button>
            <div id="submenu-projects" style="display: none; padding-left: 12px; margin-top: 4px; border-left: 2px solid #ebecf0;">
        `;
        visibleProjs.forEach(p => {
            projectOptionsHtml += `<button onclick="contextActionMoveToProject('${p.id}')" style="color:#172b4d; padding: 6px 8px; font-size: 13px;">↳ ${sanitize(p.name)}</button>`;
        });
        projectOptionsHtml += `</div>`;
    }

    if (count > 1) {
        target = document.getElementById('active-context-menu'); 
        target.innerHTML = `
            <div style="padding: 4px 12px; font-size: 11px; font-weight: bold; color: #5e6c84; text-transform: uppercase;">Bulk Actions (${count} Tasks)</div>
            <button onclick="contextActionBulkMoveTo('todo')" style="color:#0052cc;">→ Move to To Do</button>
            <button onclick="contextActionBulkMoveTo('doing')" style="color:#0052cc;">→ Move to Doing</button>
            <button onclick="contextActionBulkMoveTo('done')" style="color:#36b37e;">→ Move to Done</button>
            <button onclick="contextActionBulkMoveTo('future')" style="color:#ff991f;">⏳ Move to Future</button>
            <button onclick="contextActionBulkMoveTo('complete')" class="success-text">✓ Archive All</button>
            ${projectOptionsHtml}
            <div style="margin-top: 8px; border-top: 1px solid #dfe1e6; padding-top: 8px;"></div>
            <button onclick="contextActionBulkDelete()" class="danger-text">✕ Delete All</button>
        `;
        target.style.display = 'block'; 
        positionMenu(e, target);
        return;
    }
    
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    
    const isCreator = t.creator_id === getActiveUserObj().id || !t.creator_id;
    
    if (['todo', 'doing', 'done', 'recurring'].includes(t.status)) {
        target = document.getElementById('active-context-menu');
        target.innerHTML = `
            <button onclick="contextActionEditMain()">✎ Edit Task</button>
            ${t.status !== 'todo' ? `<button onclick="contextActionMoveTo('todo')" style="color:#0052cc;">→ Move to To Do</button>` : ''}
            ${t.status !== 'doing' ? `<button onclick="contextActionMoveTo('doing')" style="color:#0052cc;">→ Move to Doing</button>` : ''}
            ${t.status !== 'done' ? `<button onclick="contextActionMoveTo('done')" style="color:#36b37e;">→ Move to Done</button>` : ''}
            <button onclick="contextActionFutureMain()" style="color:#ff991f;">⏳ Move to Future</button>
            <button onclick="contextActionArchiveMain()" class="success-text">✓ Archive Task</button>
            ${projectOptionsHtml}
            <div style="margin-top: 8px; border-top: 1px solid #dfe1e6; padding-top: 8px;"></div>
            ${isCreator 
                ? `<button onclick="contextActionDeleteMain()" class="danger-text">✕ Delete Task</button>`
                : `<button onclick="contextActionRemoveMeMain()" class="danger-text">🏃 Hide/Remove Me</button>`
            }
        `;
    } else if (t.status === 'future') {
        target = document.getElementById('future-context-menu');
        target.innerHTML = `
            <button onclick="contextActionEditMain()">✎ Edit Task</button>
            <button onclick="contextActionMoveTo('todo')" style="color:#0052cc;">→ Move to Active</button>
            ${projectOptionsHtml}
            <div style="margin-top: 8px; border-top: 1px solid #dfe1e6; padding-top: 8px;"></div>
            ${isCreator 
                ? `<button onclick="contextActionDeleteMain()" class="danger-text">✕ Delete Task</button>`
                : `<button onclick="contextActionRemoveMeMain()" class="danger-text">🏃 Hide/Remove Me</button>`
            }
        `;
    } else {
        target = document.getElementById('archive-context-menu');
        target.innerHTML = `
            <button onclick="contextActionEditMain()">✎ Edit Task</button>
            <button onclick="contextActionMoveTo('done')" style="color:#ff991f;">⏪ Restore to Board</button>
            ${projectOptionsHtml}
            <div style="margin-top: 8px; border-top: 1px solid #dfe1e6; padding-top: 8px;"></div>
            ${isCreator 
                ? `<button onclick="contextActionDeleteMain()" class="danger-text">✕ Delete Task</button>`
                : `<button onclick="contextActionRemoveMeMain()" class="danger-text">🏃 Hide/Remove Me</button>`
            }
        `;
    }
    
    target.style.display = 'block'; 
    positionMenu(e, target);
}

function showContextMenuSubtask(e, id) { 
    e.preventDefault(); e.stopPropagation(); closeMenus(); contextTargetSubtaskId = id; subtaskContextMenu.style.display = 'block'; 
    if (window.innerWidth > 768) {
        const rect = e.currentTarget.getBoundingClientRect();
        let x = rect.right - subtaskContextMenu.offsetWidth - 5;
        let y = rect.top + 5 + window.scrollY;
        
        if (rect.top + subtaskContextMenu.offsetHeight > window.innerHeight) {
            y = rect.bottom - subtaskContextMenu.offsetHeight + window.scrollY;
        }
        subtaskContextMenu.style.left = x + 'px'; 
        subtaskContextMenu.style.top = y + 'px'; 
    }
}

function showContextMenuProject(e, id) { 
    e.preventDefault(); e.stopPropagation(); closeMenus(); 
    contextTargetProjectId = id; 
    
    const p = projects.find(x => x.id === id);
    const me = getActiveUserObj();
    const isOwner = p.owner_id === me.id || !p.owner_id;

    projectContextMenu.innerHTML = `
        <button onclick="contextActionEditProject()">✎ Edit Project</button>
        <button onclick="contextActionProjectToWorkspace()" style="color:#0052cc;">🚀 Convert to Workspace</button>
        ${isOwner 
            ? `<button onclick="contextActionDeleteProject()" class="danger-text">✕ Delete Project</button>`
            : `<button onclick="triggerHideProject('${id}'); closeMenus();" class="danger-text">🏃 Hide Project</button>`
        }
    `;
    
    projectContextMenu.style.display = 'block'; 
    positionMenu(e, projectContextMenu);
}

function triggerHideProject(id) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    document.getElementById('confirm-message').innerHTML = `Are you sure you want to hide the project <strong>"${sanitize(p.name)}"</strong>?<br>You will no longer see it, but it remains available for the rest of the team.`; 
    document.getElementById('confirm-execute-btn').className = "danger-solid"; 
    
    pendingConfirmAction = () => {
        const targetId = id;
        const user = getActiveUserObj();
        if (!user.preferences.hiddenProjects) user.preferences.hiddenProjects = [];
        user.preferences.hiddenProjects.push(targetId);
        
        apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: user.id, preferences: user.preferences });
        
        if (currentProjectId === targetId) {
            currentProjectId = null;
            localStorage.removeItem('currentProjectId');
        }
        renderAll();
    }; 
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
}

function contextActionProjectToWorkspace() {
    triggerProjectToWorkspace(contextTargetProjectId);
    closeMenus();
}

async function triggerProjectToWorkspace(projId) {
    const p = projects.find(x => x.id === projId);
    if (!p) return;
    
    document.getElementById('confirm-message').innerHTML = `Convert project <strong>"${sanitize(p.name)}"</strong> into a brand new workspace?<br>All tasks will be cleanly moved over.`; 
    document.getElementById('confirm-execute-btn').className = "action-primary"; 
    document.getElementById('confirm-execute-btn').innerText = "Convert";
    
    pendingConfirmAction = async () => { 
        document.getElementById('app-title').innerHTML = "Converting...";
        const me = getActiveUserObj();
        const newWsId = generateUUID();
        
        await apiCall('/workspaces', 'POST', { id: newWsId, name: p.name, userId: me.id, owner_id: me.id });
        await loadDataFromDB();
        
        const newProj = projects.find(pr => pr.workspace_id === newWsId && pr.name === 'My Project');
        if (newProj) {
            newProj.name = 'My First Project';
            await apiCall('/projects', 'POST', newProj);
            
            const oldTasks = tasks.filter(t => t.project_id === projId);
            for (let t of oldTasks) {
                t.project_id = newProj.id;
                await apiCall('/tasks', 'POST', t);
            }
            
            projects = projects.filter(pr => pr.id !== projId);
            await apiCall(`/projects/${projId}`, 'DELETE');
            
            navigateToProject(newWsId, newProj.id);
        }
    }; 
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
}

function contextActionHideProject(id) { triggerHideProject(id || contextTargetProjectId); closeMenus(); }
function contextActionEditProject() { openEditProjectModal(contextTargetProjectId); closeMenus(); }
function contextActionDeleteProject() { triggerDeleteProject(contextTargetProjectId); closeMenus(); }

function contextActionMoveTo(status) { moveTaskStatus(contextTargetMainId, status); closeMenus(); }
function contextActionEditMain() { editTask(contextTargetMainId); closeMenus(); } 
function contextActionDeleteMain() { triggerDeleteTask(contextTargetMainId); closeMenus(); } 
function contextActionArchiveMain() { moveTaskStatus(contextTargetMainId, 'complete'); closeMenus(); } 
function contextActionFutureMain() { moveTaskStatus(contextTargetMainId, 'future'); closeMenus(); } 
function contextActionStartMain() { moveTaskStatus(contextTargetMainId, 'todo'); closeMenus(); } 
function contextActionRestoreMain() { moveTaskStatus(contextTargetMainId, 'done'); closeMenus(); } 
function contextActionRemoveMeMain() { triggerRemoveMeTask(contextTargetMainId); closeMenus(); }
function contextActionEditSubtask() { openSubtaskDetails(contextTargetSubtaskId); closeMenus(); } 
function contextActionDeleteSubtask() { removeSubtask(contextTargetSubtaskId); closeMenus(); }

function handleTabDragStart(e, id) { e.dataTransfer.setData("projectId", id); setTimeout(() => e.target.classList.add('dragging-tab'), 0); }
function handleTabDrop(e, targetId) {
    e.preventDefault(); 
    e.currentTarget.style.background = ''; 
    e.currentTarget.style.borderColor = '';
    
    const draggedProjId = e.dataTransfer.getData("projectId"); 
    if (draggedProjId) {
        if (draggedProjId === targetId) return;
        const user = getActiveUserObj(); 
        let currentOrder = projects.filter(p => p.workspace_id === currentWorkspaceId).map(p => p.id);
        const fromIdx = currentOrder.indexOf(draggedProjId); 
        const toIdx = currentOrder.indexOf(targetId);
        if (fromIdx > -1 && toIdx > -1) { 
            const [movedId] = currentOrder.splice(fromIdx, 1); 
            currentOrder.splice(toIdx, 0, movedId); 
            user.preferences.projectOrder = [...new Set([...currentOrder, ...user.preferences.projectOrder])]; 
            renderProjects(); 
            apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: user.id, preferences: user.preferences });
        }
        return;
    }

    const draggedTaskId = e.dataTransfer.getData("taskId");
    if (draggedTaskId) {
        let tasksToMove = selectedTasks.size > 0 && selectedTasks.has(draggedTaskId) ? Array.from(selectedTasks) : [draggedTaskId];
        tasksToMove.forEach(id => {
            const t = tasks.find(x => x.id === id);
            if (t && t.project_id !== targetId) {
                t.project_id = targetId;
                apiCall('/tasks', 'POST', t);
            }
        });
        selectedTasks.clear();
        renderAll();
    }
}

function dragStart(e, id) { 
    if (!selectedTasks.has(id)) {
        selectedTasks.clear();
        selectedTasks.add(id);
        document.querySelectorAll('.card').forEach(c => {
            if (c.getAttribute('data-id') === id) {
                c.style.outline = '2px solid #0052cc';
                c.style.backgroundColor = '#e6fcff';
            } else {
                c.style.outline = '';
                c.style.backgroundColor = '';
            }
        });
    }
    e.dataTransfer.setData("taskId", id); 
    setTimeout(() => e.target.classList.add('dragging'), 0); 
}

function dragEnd(e) {
    e.target.classList.remove('dragging'); 
    const draggedId = e.target.getAttribute('data-id'); 
    const draggedTask = tasks.find(t => t.id === draggedId); 
    if (!draggedTask) return;
    
    let statuses = (currentView === 'active') ? ['todo', 'doing', 'done'] : (currentView === 'future') ? ['future'] : (currentView === 'recurring') ? ['recurring'] : ['complete'];
    
    let droppedStatus = null;
    statuses.forEach(status => { 
        const list = document.getElementById(status + '-list'); 
        const cards = list.querySelectorAll('.card'); 
        let isHere = false;
        cards.forEach(card => { if (card.getAttribute('data-id') === draggedId) isHere = true; });
        if (isHere) droppedStatus = status;
    });

    if (droppedStatus) {
        let tasksToMove = selectedTasks.size > 0 && selectedTasks.has(draggedId) ? Array.from(selectedTasks) : [draggedId];
        
        tasksToMove.forEach(id => {
            const t = tasks.find(x => x.id === id);
            if (t) {
                const oldStatus = t.status;
                t.status = droppedStatus;
                
                if ((droppedStatus === 'done' || droppedStatus === 'complete' || droppedStatus === 'archive') && (oldStatus !== 'done' && oldStatus !== 'complete' && oldStatus !== 'archive')) {
                    t.completed_at = new Date().toISOString();
                    if (t.timer_running) {
                        const now = Date.now();
                        const start = parseInt(t.timer_started_at, 10) || now;
                        t.timer_elapsed = parseInt(t.timer_elapsed, 10) + (now - start);
                        t.timer_running = false;
                        t.timer_started_at = null;
                    }
                } else if (droppedStatus !== 'done' && droppedStatus !== 'complete' && droppedStatus !== 'archive') {
                    t.completed_at = null;
                }
                
                apiCall('/tasks', 'POST', t);
            }
        });

        const user = getActiveUserObj();
        if (!user.preferences.taskOrder) user.preferences.taskOrder = [];
        const list = document.getElementById(droppedStatus + '-list');
        const visualOrder = Array.from(list.querySelectorAll('.card')).map(c => c.getAttribute('data-id'));
        
        user.preferences.taskOrder = user.preferences.taskOrder.filter(id => !visualOrder.includes(id) && !tasksToMove.includes(id));
        user.preferences.taskOrder = [...visualOrder, ...tasksToMove.filter(id => id !== draggedId), ...user.preferences.taskOrder];
        apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: user.id, preferences: user.preferences });
        
        if (tasksToMove.length > 1) {
            renderBoard(); 
        }
    }
}
function allowDrop(e, status) { e.preventDefault(); const list = document.getElementById(status + '-list'); const dragEl = document.querySelector('.dragging'); if (!dragEl) return; const afterEl = [...list.querySelectorAll('.card:not(.dragging)')].reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2; return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest; }, { offset: Number.NEGATIVE_INFINITY }).element; if (afterEl == null) list.appendChild(dragEl); else list.insertBefore(dragEl, afterEl); }

function inlineAdjustCounter(id, amount) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    t.counter = parseInt(t.counter || 0, 10) + amount;
    if (t.counter < 0) t.counter = 0;

    if (amount > 0) {
        const rep = {
            id: generateUUID(),
            task_id: id,
            user_id: getActiveUserObj().id,
            created_at: new Date().toISOString()
        };
        taskRepetitions.push(rep);
        apiCall('/repetitions', 'POST', rep);
    }

    document.querySelectorAll(`.inline-counter-val-${id}`).forEach(el => {
        el.innerText = t.counter;
    });

    silentSaveTaskDB(t);
}

function clearTimer() {
    if (!draftTask) return;
    syncFormToDraft(); 
    draftTask.timer_elapsed = 0;
    draftTask.timer_running = false;
    draftTask.timer_started_at = null;
    clearInterval(activeTimerInterval);
    document.getElementById('task-timer-display').innerText = "00:00:00";
    
    const btn = document.getElementById('timer-toggle-btn');
    btn.innerText = '▶ Start';
    btn.className = 'action-success';
    btn.style.background = '#e3fcef';
    btn.style.color = '#006644';
    btn.style.border = '1px solid #36b37e';
    
    silentSaveTaskDB(draftTask);
}

function toggleTimer() {
    if (!draftTask) return;
    syncFormToDraft(); 
    const btn = document.getElementById('timer-toggle-btn');
    
    if (draftTask.timer_running) {
        const now = Date.now();
        const start = parseInt(draftTask.timer_started_at, 10) || now;
        const sessionDuration = now - start;
        
        draftTask.timer_elapsed = parseInt(draftTask.timer_elapsed || 0, 10) + sessionDuration;
        draftTask.timer_running = false;
        draftTask.timer_started_at = null;
        
       if (sessionDuration > 1000) { 
            const nativeProj = projects.find(p => p.id === draftTask.project_id);
            const nativeWsId = nativeProj ? nativeProj.workspace_id : currentWorkspaceId;
            
            const newLog = {
                id: generateUUID(),
                user_id: getActiveUserObj().id,
                workspace_id: nativeWsId,
                project_id: draftTask.project_id,
                task_id: draftTask.id,
                duration_ms: sessionDuration,
                created_at: new Date().toISOString()
            };
            timeLogs.push(newLog); 
            apiCall('/time_logs', 'POST', newLog);
        }
        
        btn.innerText = '▶ Start';
        btn.className = 'action-success';
        btn.style.background = '#e3fcef';
        btn.style.color = '#006644';
        btn.style.border = '1px solid #36b37e';
        
        clearInterval(activeTimerInterval);
    } else {
        draftTask.timer_running = true;
        draftTask.timer_started_at = Date.now();
        
        btn.innerText = '⏸ Pause';
        btn.className = 'danger-solid';
        btn.style.background = '#de350b';
        btn.style.color = 'white';
        btn.style.border = '1px solid #de350b';
        
        startTimerInterval();
    }
    silentSaveTaskDB(draftTask); 
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerDisplay() {
    if (!draftTask) return;
    let elapsed = parseInt(draftTask.timer_elapsed || 0, 10);
    if (draftTask.timer_running && draftTask.timer_started_at) {
        elapsed += (Date.now() - parseInt(draftTask.timer_started_at, 10));
    }
    document.getElementById('task-timer-display').innerText = formatTime(elapsed);
}

function startTimerInterval() {
    clearInterval(activeTimerInterval);
    updateTimerDisplay();
    activeTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateGlobalTimer() {
    const indicator = document.getElementById('global-timer-indicator');
    const runningTask = tasks.find(t => t.timer_running);
    
    if (!runningTask) {
        indicator.style.display = 'none';
        return;
    }
    
    indicator.style.display = 'flex';
    let elapsed = parseInt(runningTask.timer_elapsed || 0, 10);
    if (runningTask.timer_started_at) {
        elapsed += (Date.now() - parseInt(runningTask.timer_started_at, 10));
    }
    document.getElementById('global-timer-text').innerText = sanitize(runningTask.title) + " - " + formatTime(elapsed);
    indicator.onclick = () => editTask(runningTask.id);
}

function generateTimeReportHTML(taskId) {
    const logs = timeLogs.filter(l => l.task_id === taskId).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    if (logs.length === 0) return `<p style="color: #5e6c84; font-size: 13px;">No time logged yet.</p>`;

    const userGroups = {};
    logs.forEach(log => {
        const u = log.user_id;
        const ms = parseInt(log.duration_ms, 10);
        const d = log.created_at ? new Date(log.created_at) : new Date();
        const dateKey = d.toLocaleDateString();
        
        if (!userGroups[u]) userGroups[u] = { total: 0, dates: {} };
        userGroups[u].total += ms;
        
        if (!userGroups[u].dates[dateKey]) userGroups[u].dates[dateKey] = { total: 0, sessions: [] };
        userGroups[u].dates[dateKey].total += ms;
        userGroups[u].dates[dateKey].sessions.push({ ms: ms, time: d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) });
    });

    let html = `<div style="display: flex; flex-direction: column; gap: 10px;">`;
    for (let u in userGroups) {
        const uData = userGroups[u];
        html += `
        <details style="border: 1px solid #dfe1e6; border-radius: 6px; overflow: hidden;">
            <summary style="background: #f4f5f7; padding: 10px 12px; cursor: pointer; font-weight: bold; color: #172b4d; display: flex; justify-content: space-between; outline: none;">
                <span>👤 ${sanitize(getUserName(u))}</span>
                <span style="color: #0052cc;">${formatTime(uData.total)}</span>
            </summary>
            <div style="padding: 10px;">`;
        
        for (let dKey in uData.dates) {
            const dData = uData.dates[dKey];
            let isToday = (dKey === new Date().toLocaleDateString()) ? ' (Today)' : '';
            html += `
            <details style="margin-bottom: 6px; border-left: 2px solid #ebecf0; padding-left: 10px;">
                <summary style="padding: 4px 6px; cursor: pointer; font-size: 13px; font-weight: 600; color: #42526e; display: flex; justify-content: space-between; outline: none;">
                    <span>📅 ${dKey}${isToday}</span>
                    <span style="color: #36b37e;">${formatTime(dData.total)}</span>
                </summary>
                <div style="padding: 4px 10px; font-size: 12px; color: #5e6c84;">`;
            
            dData.sessions.forEach(sess => {
                html += `<div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #ebecf0; padding: 4px 0;">
                    <span>↳ Session at ${sess.time}</span>
                    <span style="font-family: monospace;">${formatTime(sess.ms)}</span>
                </div>`;
            });
            
            html += `</div></details>`;
        }
        html += `</div></details>`;
    }
    html += `</div>`;
    return html;
}

function openTimeReportModal() {
    const taskId = draftSubtaskId ? draftSubtaskId : draftTask.id;
    const content = document.getElementById('time-report-content');
    content.innerHTML = generateTimeReportHTML(taskId);
    
    const m = document.getElementById('time-report-modal');
    m.showModal();
}

function openRepetitionReportModal(taskId) {
    const reps = taskRepetitions.filter(r => r.task_id === taskId).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    let html = '';
    
    if (reps.length === 0) {
        html = '<p style="color: #5e6c84; font-size: 13px;">No repetitions logged yet.</p>';
    } else {
        html += `<table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 2px solid #dfe1e6;">
                <th style="padding: 8px;">Date & Time</th>
                <th style="padding: 8px;">Completed By</th>
            </tr>`;
        reps.forEach(r => {
            const d = new Date(r.created_at);
            const dateStr = d.toLocaleDateString() + ' at ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            html += `<tr style="border-bottom: 1px solid #ebecf0;">
                <td style="padding: 8px;">${dateStr}</td>
                <td style="padding: 8px; font-weight: bold;">${sanitize(getUserName(r.user_id))}</td>
            </tr>`;
        });
        html += `</table>`;
    }

    document.getElementById('repetition-report-content').innerHTML = html;
    const m = document.getElementById('repetition-report-modal');
    m.showModal();
}

function openModal(defaultStatus) {
    lockBody();
    clearInterval(activeTimerInterval);
    originalAssignees = [];
    
    if (!currentProjectId) {
        unlockBody();
        alert("Please select or create a Project before adding a task.");
        return;
    }
    
    if (typeof defaultStatus !== 'string') {
        defaultStatus = (currentView === 'future') ? 'future' : (currentView === 'archive' ? 'complete' : (currentView === 'recurring' ? 'recurring' : 'todo'));
    }
    
    const proj = projects.find(p => p.id === currentProjectId);
    let defaultAssignees = [];
    if (proj && proj.isSecret) {
        defaultAssignees = [getActiveUserObj().id];
    }
    
    draftTask = { 
        id: generateUUID(), title: '', description: '', assignees: defaultAssignees, due_date: '', status: defaultStatus, urgency: 'low', project_id: currentProjectId, parent_task_id: null,
        counter: 0, timer_running: false, timer_started_at: null, timer_elapsed: 0, completed_at: null, creator_id: getActiveUserObj().id
    };
    
    draftSubtasks = []; draftSubtaskId = null; document.getElementById('task-form').reset(); updateFormUI(); 
    
    document.getElementById('gcal-checkbox-container').style.display = 'flex';
    document.getElementById('task-gcal-sync').checked = false;
    
    const modal = document.getElementById('task-modal');
    modal.showModal();
    setTimeout(() => { modal.scrollTop = 0; }, 10);
}

function editTask(id) {
    lockBody();
    clearInterval(activeTimerInterval);
    
    draftTask = JSON.parse(JSON.stringify(tasks.find(t => t.id === id))); 
    
    const taskLogs = timeLogs.filter(l => l.task_id === id);
    let actualElapsed = taskLogs.reduce((sum, log) => sum + parseInt(log.duration_ms || 0, 10), 0);
    
    if (actualElapsed > 0) {
        if (Math.abs(parseInt(draftTask.timer_elapsed || 0, 10) - actualElapsed) > 5000) {
            draftTask.timer_elapsed = actualElapsed;
            if (!draftTask.timer_running) {
                silentSaveTaskDB(draftTask); 
            }
        }
    }

    draftSubtasks = tasks.filter(t => t.parent_task_id === id).map(st => JSON.parse(JSON.stringify(st)));
    originalAssignees = [...(draftTask.assignees || [])];
    draftSubtaskId = null; updateFormUI(); 
    
    document.getElementById('gcal-checkbox-container').style.display = 'flex';
    document.getElementById('task-gcal-sync').checked = false;
    
    const modal = document.getElementById('task-modal');
    modal.showModal();
    setTimeout(() => { modal.scrollTop = 0; }, 10);
}

function closeModal() { 
    unlockBody(); 
    clearInterval(activeTimerInterval);
    document.getElementById('task-modal').close(); 
    draftTask = null; draftSubtasks = []; 
}

function updateFormUI() {
    if (!draftTask) return; const data = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask; if (!data) return;

    document.getElementById('task-title').value = data.title || '';
    document.getElementById('task-desc').value = data.description || '';

    const dateInput = document.getElementById('task-due-date');
    const dateBtn = document.getElementById('pill-date');
    if (dateInput && dateBtn) {
        const parent = dateBtn.parentElement;
        parent.style.position = 'relative';
        dateInput.style.position = 'absolute';
        dateInput.style.top = '0';
        dateInput.style.left = '0';
        dateInput.style.width = '100%';
        dateInput.style.height = '100%';
        dateInput.style.opacity = '0';
        dateInput.style.cursor = 'pointer';
        dateInput.style.zIndex = '10';
        
        dateInput.value = data.due_date || '';
        
        dateInput.onchange = (e) => {
            const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
            if(target) {
                target.due_date = e.target.value;
                updatePills();
            }
        };
    }

    switchTaskModalTab('details');
    updatePills();

    const hasTime = parseInt(data.timer_elapsed, 10) > 0 || data.timer_running;
    if (hasTime) {
        document.getElementById('timer-empty-btn').style.display = 'none';
        document.getElementById('timer-active-section').style.display = 'flex';
        const btn = document.getElementById('timer-toggle-btn');
        if (data.timer_running) {
            btn.innerText = '⏸ Pause';
            btn.className = 'danger-solid';
            btn.style.background = '#de350b';
            btn.style.color = 'white';
            btn.style.border = '1px solid #de350b';
            startTimerInterval();
        } else {
            btn.innerText = '▶ Start';
            btn.className = 'action-success';
            btn.style.background = '#e3fcef';
            btn.style.color = '#006644';
            btn.style.border = '1px solid #36b37e';
            updateTimerDisplay();
        }
    } else {
        document.getElementById('timer-empty-btn').style.display = 'block';
        document.getElementById('timer-active-section').style.display = 'none';
    }

    document.getElementById('modal-back-btn').style.display = draftSubtaskId ? 'inline-block' : 'none';
    document.getElementById('subtasks-form-section').style.display = draftSubtaskId ? 'none' : 'block';

    if (draftSubtaskId) {
        document.getElementById('gcal-checkbox-container').style.display = 'none';
        document.getElementById('task-gcal-sync').checked = false;
    } else {
        document.getElementById('gcal-checkbox-container').style.display = 'flex';
    }

    if(!draftSubtaskId) renderSubtasks();

    const isExisting = draftSubtaskId ? !draftSubtaskId.startsWith('sub_') : tasks.some(t => t.id === draftTask.id);
    document.getElementById('tab-btn-activity').style.display = isExisting ? 'block' : 'none';
}

function syncFormToDraft() {
    if (!draftTask) return;
    const data = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    if (data) {
        data.title = document.getElementById('task-title').value.trim();
        data.description = document.getElementById('task-desc').value;
        const dateEl = document.getElementById('task-due-date');
        if (dateEl) data.due_date = dateEl.value;
    }
}

document.getElementById('task-form').addEventListener('submit', async function(e) {
    e.preventDefault(); syncFormToDraft(); 
    
    await saveTaskDB(draftTask);
    for (const st of draftSubtasks) { if (st.id.includes('sub_') || st.id.includes('temp')) st.id = generateUUID(); st.parent_task_id = draftTask.id; await saveTaskDB(st); }

    const me = getActiveUserObj();
    const allAssignees = draftTask.assignees || [];
    const newlyAdded = allAssignees.filter(id => !originalAssignees.includes(id) && id !== me.id);
    
    if (newlyAdded.length > 0 && currentWorkspaceId) {
        const p = projects.find(x => x.id === currentProjectId);
        const projName = p ? p.name : 'Unknown Project';
        
        const isPrivateDM = allAssignees.length <= 2 && newlyAdded.length === 1;

        if (isPrivateDM) {
            const targetId = newlyAdded[0];
            await apiCall('/messages', 'POST', {
                id: generateUUID(),
                workspace_id: currentWorkspaceId,
                sender_id: me.id, 
                sender_name: activeUserName,
                recipient_id: targetId,
                content: `🤖 System: I assigned you to "${draftTask.title}" in ${projName}.`,
                related_task_id: draftTask.id,
                created_at: new Date().toISOString()
            });
        } else {
            const addedNames = newlyAdded.map(id => getUserName(id)).join(', ');
            await apiCall('/messages', 'POST', {
                id: generateUUID(),
                workspace_id: currentWorkspaceId,
                sender_id: 'system',
                sender_name: 'System',
                recipient_id: null,
                content: `🤖 System: ${activeUserName} assigned ${addedNames} to "${draftTask.title}" in ${projName}.`,
                related_task_id: draftTask.id,
                created_at: new Date().toISOString()
            });
        }
    }
    
    const syncGcal = document.getElementById('task-gcal-sync').checked;
    if (syncGcal && !draftSubtaskId) {
        let gcalDesc = draftTask.description || '';
        if (draftSubtasks && draftSubtasks.length > 0) {
            gcalDesc += '\n\nSubtasks:\n' + draftSubtasks.map(st => '• ' + st.title).join('\n');
        }
        const title = encodeURIComponent(draftTask.title || 'New Task');
        const desc = encodeURIComponent(gcalDesc);
        let dateParam = '';
        if (draftTask.due_date) {
            const dStr1 = draftTask.due_date.replace(/-/g, '');
            const dObj = new Date(draftTask.due_date + 'T12:00:00');
            dObj.setDate(dObj.getDate() + 1);
            const dStr2 = dObj.toISOString().split('T')[0].replace(/-/g, '');
            dateParam = `&dates=${dStr1}/${dStr2}`;
        }
        const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${desc}${dateParam}`;
        window.open(gcalUrl, '_blank');
    }

    closeModal();
});

function openAssigneePromptModal() { 
    syncFormToDraft(); 
    renderAssigneeCheckboxes();
    const m = document.getElementById('assignee-prompt-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
} 

function toggleDraftAssignee(userId, isChecked) {
    const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    if (!target) return;
    
    if (!target.assignees) target.assignees = [];
    if (isChecked) {
        if (!target.assignees.includes(userId)) target.assignees.push(userId);
    } else {
        target.assignees = target.assignees.filter(id => id !== userId);
    }
}

function closeAssigneePromptModal() { 
    document.getElementById('assignee-prompt-modal').close(); 
    updateFormUI(); 
}

function renderAssigneeCheckboxes() {
    const container = document.getElementById('assignee-checkbox-container'); container.innerHTML = '';
    const allKnownUsers = getVisibleUsers();
    if (allKnownUsers.length === 0) { container.innerHTML = '<span style="color:#5e6c84; font-size:12px;">No one added yet.</span>'; return; }
    
    const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    const selected = target ? (target.assignees || []) : [];
    
    allKnownUsers.forEach(u => { 
        const isChecked = selected.includes(u.id) ? 'checked' : ''; 
        const div = document.createElement('div'); div.className = 'list-item assignee-item'; 
        div.innerHTML = `<label style="flex: 1; margin: 0; cursor: pointer; display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" class="assignee-check" value="${u.id}" ${isChecked} onchange="toggleDraftAssignee('${u.id}', this.checked)"> 
            <span class="title" style="color: #172b4d;">${sanitize(u.name)}</span>
        </label>`; 
        container.appendChild(div); 
    });
}

function openSubtaskPromptModal() { 
    syncFormToDraft(); 
    document.getElementById('new-subtask-name').value = ''; 
    const m = document.getElementById('subtask-prompt-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
} 
function closeSubtaskPromptModal() { document.getElementById('subtask-prompt-modal').close(); }

document.getElementById('subtask-prompt-form').addEventListener('submit', function(e) { e.preventDefault(); const title = document.getElementById('new-subtask-name').value.trim(); if(title && draftTask) { draftSubtasks.push({ id: 'sub_' + generateUUID(), project_id: currentProjectId, parent_task_id: draftTask.id, title: title, status: 'todo', description: '', assignees: [], due_date: '', urgency: 'low', creator_id: getActiveUserObj().id }); renderSubtasks(); } closeSubtaskPromptModal(); });
function openSubtaskDetails(id) { syncFormToDraft(); draftSubtaskId = id; updateFormUI(); } function backToParentTask() { syncFormToDraft(); draftSubtaskId = null; updateFormUI(); }
function toggleSubtask(id) { const st = draftSubtasks.find(s => s.id === id); if(st) st.status = (st.status === 'complete') ? 'todo' : 'complete'; renderSubtasks(); } 

function removeSubtask(id) { 
    draftSubtasks = draftSubtasks.filter(s => s.id !== id); 
    renderSubtasks(); 
    if (!id.includes('sub_') && !id.includes('temp')) {
        apiCall(`/tasks/${id}`, 'DELETE');
        tasks = tasks.filter(t => t.id !== id);
    }
}

function renderSubtasks() {
    const container = document.getElementById('subtasks-container'); container.innerHTML = '';
    if (draftSubtasks.length === 0) { container.innerHTML = '<span style="color:#5e6c84; font-size:12px; margin-top:4px;">No subtasks added yet.</span>'; return; }
    draftSubtasks.forEach(st => { const isComplete = st.status === 'complete'; const div = document.createElement('div'); div.className = `list-item subtask-item ${isComplete ? 'completed' : ''}`; div.setAttribute('onclick', `openSubtaskDetails('${st.id}')`); div.setAttribute('oncontextmenu', `showContextMenuSubtask(event, '${st.id}')`); div.innerHTML = `<input type="checkbox" ${isComplete ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleSubtask('${st.id}')" title="Mark complete"><span class="title">${sanitize(st.title)}</span><div class="list-actions subtask-actions"><button type="button" class="edit" onclick="event.stopPropagation(); openSubtaskDetails('${st.id}')" title="Edit Subtask">✎</button><button type="button" class="danger" style="padding: 2px 6px;" onclick="event.stopPropagation(); removeSubtask('${st.id}')" title="Delete Subtask">&times;</button></div>`; container.appendChild(div); }); container.scrollTop = container.scrollHeight;
}

document.getElementById('prompt-form').addEventListener('submit', async function(e) {
    e.preventDefault(); const name = document.getElementById('new-project-name').value.trim();
    if (name) { 
        const newId = generateUUID(); currentProjectId = newId; localStorage.setItem('currentProjectId', newId); 
        await saveProjectDB({ id: newId, name: name, isSecret: document.getElementById('new-project-secret').checked, workspace_id: currentWorkspaceId, owner_id: getActiveUserObj().id }); 
        renderAll(); 
    }
    closePromptModal();
});

function openEditProjectModal(id) {
    lockBody();
    contextTargetProjectId = id; 
    const p = projects.find(x => x.id === id);
    if (!p) return;
    document.getElementById('edit-project-name').value = p.name;
    document.getElementById('edit-project-secret').checked = p.isSecret;
    
    renderProjectComments(id);

    const m = document.getElementById('edit-project-modal');
    m.showModal();
    setTimeout(() => m.scrollTop = 0, 10);
}

function closeEditProjectModal() { unlockBody(); document.getElementById('edit-project-modal').close(); }

async function autoSaveProject() {
    const name = document.getElementById('edit-project-name').value.trim();
    const isSecret = document.getElementById('edit-project-secret').checked;
    if (name && contextTargetProjectId) {
        const p = projects.find(x => x.id === contextTargetProjectId);
        if (p) {
            p.name = name;
            p.isSecret = isSecret;
            await saveProjectDB(p);
        }
    }
}

document.getElementById('create-workspace-form').addEventListener('submit', async function(e) {
    e.preventDefault(); const name = document.getElementById('create-workspace-name').value.trim();
    if (name) { 
        const newId = generateUUID(); const currentUserObj = getActiveUserObj();
        await apiCall('/workspaces', 'POST', { id: newId, name: name, userId: currentUserObj.id, owner_id: currentUserObj.id }); 
        currentWorkspaceId = newId; localStorage.setItem('currentWorkspaceId', newId); currentProjectId = null; 
        await loadDataFromDB(); 
    }
    closeCreateWorkspaceModal();
});

function editCurrentWorkspace() {
    lockBody();
    workspaceContextMenu.style.display = 'none';
    const currentWs = workspaces.find(w => w.id === currentWorkspaceId);
    if(currentWs) { 
        document.getElementById('edit-workspace-name').value = currentWs.name; 
        const m = document.getElementById('edit-workspace-modal');
        m.showModal(); 
        setTimeout(() => m.scrollTop = 0, 10);
    }
}
function closeEditWorkspaceModal() { unlockBody(); document.getElementById('edit-workspace-modal').close(); }

document.getElementById('edit-workspace-form').addEventListener('submit', async function(e) {
    e.preventDefault(); const name = document.getElementById('edit-workspace-name').value.trim();
    if (name) { await apiCall('/workspaces', 'POST', { id: currentWorkspaceId, name: name, userId: getActiveUserObj().id, owner_id: workspaces.find(w=>w.id===currentWorkspaceId)?.owner_id }); await loadDataFromDB(); }
    closeEditWorkspaceModal();
});

function deleteCurrentWorkspace(e) {
    e.preventDefault(); e.stopPropagation(); workspaceContextMenu.style.display = 'none';
    const myWorkspaces = workspaces.filter(ws => getActiveUserObj().workspace_ids.includes(ws.id));
    if (myWorkspaces.length <= 1) { alert("You cannot leave or delete your only workspace."); return; }
    
    const ws = workspaces.find(w => w.id === currentWorkspaceId);
    const me = getActiveUserObj();
    const isOwner = ws.owner_id === me.id || !ws.owner_id;
    
    if (isOwner) {
        document.getElementById('confirm-message').innerHTML = `Are you sure you want to delete workspace <strong>"${sanitize(ws.name)}"</strong> and all its projects and tasks?<br>This cannot be undone.`; 
        document.getElementById('confirm-execute-btn').className = "danger-solid";
        
        pendingConfirmAction = async () => { 
            await apiCall(`/workspaces/${currentWorkspaceId}`, 'DELETE'); 
            currentWorkspaceId = null; localStorage.removeItem('currentWorkspaceId');
            await loadDataFromDB(); 
        }; 
    } else {
        document.getElementById('confirm-message').innerHTML = `Are you sure you want to leave workspace <strong>"${sanitize(ws.name)}"</strong>?<br>You will no longer be able to see its projects.`; 
        document.getElementById('confirm-execute-btn').className = "danger-solid";
        
        pendingConfirmAction = async () => { 
            await apiCall(`/users/${me.id}/${currentWorkspaceId}`, 'DELETE'); 
            currentWorkspaceId = null; localStorage.removeItem('currentWorkspaceId');
            await loadDataFromDB(); 
        }; 
    }
    
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal();
    setTimeout(() => m.scrollTop = 0, 10);
}

document.getElementById('add-user-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-ws-user-name').value.trim(); const email = document.getElementById('new-ws-user-email').value.trim(); const role = document.getElementById('new-ws-user-role').value;
    if (name && email) { 
        const newUserId = generateUUID(); 
        const inviterName = activeUserName;
        const wsObj = workspaces.find(w => w.id === currentWorkspaceId);
        const workspaceName = wsObj ? wsObj.name : 'TaskBoard';
        const inviteLink = window.location.origin; 
        await apiCall('/users', 'POST', { id: newUserId, name, email, role, workspace_id: currentWorkspaceId, inviter_name: inviterName, workspace_name: workspaceName, invite_link: inviteLink }); 
        await loadDataFromDB(); 
    }
    closeAddUserModal();
});

function deleteWorkspaceUser(id, name) {
    if (getVisibleUsers().length <= 1) { alert("You must have at least one user in the workspace."); return; }
    document.getElementById('confirm-message').innerHTML = `Are you sure you want to remove <strong>${sanitize(name)}</strong> from this workspace?`; document.getElementById('confirm-execute-btn').className = "danger-solid";
    pendingConfirmAction = async () => { await apiCall(`/users/${id}/${currentWorkspaceId}`, 'DELETE'); await loadDataFromDB(); }; 
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal();
    setTimeout(() => m.scrollTop = 0, 10);
}

function triggerDeleteTask(id) { 
    document.getElementById('confirm-message').innerHTML = "Delete this task?<br>This cannot be undone."; 
    document.getElementById('confirm-execute-btn').className = "danger-solid"; 
    pendingConfirmAction = () => deleteTaskDB(id); 
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
}

function triggerDeleteProject(id) { 
    if (projects.filter(p => p.workspace_id === currentWorkspaceId).length <= 1) { alert("Cannot delete your only project."); return; } 
    document.getElementById('confirm-message').innerHTML = "Delete this project and all its tasks?<br>This cannot be undone."; 
    document.getElementById('confirm-execute-btn').className = "danger-solid"; 
    pendingConfirmAction = () => deleteProjectDB(id); 
    lockBody(); 
    const m = document.getElementById('confirm-modal');
    m.showModal(); 
    setTimeout(() => m.scrollTop = 0, 10);
}

function executeConfirm() { 
    if (pendingConfirmAction) pendingConfirmAction(); 
    unlockBody(); document.getElementById('confirm-modal').close(); pendingConfirmAction = null; 
    document.getElementById('confirm-execute-btn').innerText = 'Confirm';
}
function closeConfirmModal() { 
    unlockBody(); document.getElementById('confirm-modal').close(); pendingConfirmAction = null; 
    document.getElementById('confirm-execute-btn').innerText = 'Confirm';
}

function triggerRemoveMeTask(id) {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    
    const me = getActiveUserObj();
    t.assignees = t.assignees.filter(uid => uid !== me.id); 
    
    if (!me.preferences.hiddenTasks) me.preferences.hiddenTasks = [];
    if (!me.preferences.hiddenTasks.includes(id)) me.preferences.hiddenTasks.push(id);
    
    saveTaskDB(t);
    apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: me.id, preferences: me.preferences });
}

function triggerUnhideTask(id) {
    const me = getActiveUserObj();
    if (!me.preferences.hiddenTasks) return;
    me.preferences.hiddenTasks = me.preferences.hiddenTasks.filter(tid => tid !== id);
    apiCall('/settings', 'POST', { workspace_id: currentWorkspaceId, user_id: me.id, preferences: me.preferences });
    renderAll();
}

function removeAssigneeFromTask(userId) {
    if (!draftTask) return;
    syncFormToDraft();
    const cb = document.querySelector(`.assignee-check[value="${userId}"]`);
    if (cb) cb.checked = false;
    draftTask.assignees = draftTask.assignees.filter(id => id !== userId);
    updateFormUI();
}

// --- MINIMALIST UI STATE HANDLERS ---
function switchTaskModalTab(tab) {
    document.getElementById('tab-btn-details').classList.toggle('active', tab === 'details');
    document.getElementById('tab-btn-activity').classList.toggle('active', tab === 'activity');
    document.getElementById('task-tab-details').style.display = tab === 'details' ? 'block' : 'none';
    document.getElementById('task-tab-activity').style.display = tab === 'activity' ? 'flex' : 'none';
    
    if (tab === 'activity' && draftTask) {
        renderTaskComments(draftSubtaskId || draftTask.id);
    }
}

function setTaskStatus(val) {
    if(!draftTask) return;
    const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    
    const oldStatus = target.status;
    target.status = val;
    
    if ((val === 'done' || val === 'complete' || val === 'archive') && (oldStatus !== 'done' && oldStatus !== 'complete' && oldStatus !== 'archive')) {
        target.completed_at = new Date().toISOString();
    } else if (val !== 'done' && val !== 'complete' && val !== 'archive') {
        target.completed_at = null;
    }
    
    updatePills();
}

function setTaskUrgency(val) {
    if(!draftTask) return;
    const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    target.urgency = val;
    updatePills();
}

function revealTimer() {
    document.getElementById('timer-empty-btn').style.display = 'none';
    document.getElementById('timer-active-section').style.display = 'flex';
}

function updatePills() {
    const target = draftSubtaskId ? draftSubtasks.find(s => s.id === draftSubtaskId) : draftTask;
    if (!target) return;

    // Assignees Pill
    const assigneeBtn = document.getElementById('pill-assignee');
    if (!target.assignees || target.assignees.length === 0) {
        assigneeBtn.innerText = '👤 Unassigned';
    } else if (target.assignees.length === 1) {
        assigneeBtn.innerText = `👤 ${sanitize(getUserName(target.assignees[0]))}`;
    } else {
        assigneeBtn.innerText = `👤 ${target.assignees.length} Assignees`;
    }

    // Date Pill
    const dateInput = document.getElementById('task-due-date');
    const dateBtn = document.getElementById('pill-date');
    if (target.due_date) {
        const d = new Date(target.due_date + 'T12:00:00');
        dateBtn.innerText = `📅 ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    } else {
        dateBtn.innerText = '📅 No Date';
    }

    // Urgency Pill
    const uMap = { low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High' };
    document.getElementById('pill-urgency').innerText = uMap[target.urgency] || '🟢 Low';

    // Status Pill
    const sMap = { todo: '▶️ To Do', doing: '⏳ Doing', done: '✅ Done', future: '🔮 Future', recurring: '🔁 Recurring', complete: '📦 Archived' };
    document.getElementById('pill-status').innerText = sMap[target.status] || '▶️ To Do';
}

function switchAnalyticsTab(tab) {
    document.getElementById('tab-overview').classList.toggle('active', tab === 'overview');
    document.getElementById('tab-time-report').classList.toggle('active', tab === 'time-report');
    document.getElementById('analytics-overview').style.display = tab === 'overview' ? 'grid' : 'none';
    document.getElementById('analytics-time-report').style.display = tab === 'time-report' ? 'flex' : 'none';
    if (tab === 'time-report') renderDetailedTimeReport();
}

function openAnalyticsModal() {
    document.getElementById('settings-modal').close(); 
    lockBody(); 
    const m = document.getElementById('analytics-modal');
    if (m) {
        m.showModal(); 
        switchAnalyticsTab('overview');
        renderAnalyticsCharts();
        setTimeout(() => m.scrollTop = 0, 10);
    }
}

function closeAnalyticsModal() { 
    unlockBody(); 
    document.getElementById('analytics-modal').close(); 
    document.getElementById('settings-modal').showModal(); 
}

function renderAnalyticsCharts() {
    const allowedProjIds = projects.filter(p => p.workspace_id === currentWorkspaceId).map(p => p.id);
    const wsTasks = tasks.filter(t => allowedProjIds.includes(t.project_id));
    const wsLogs = timeLogs.filter(l => l.workspace_id === currentWorkspaceId);

    const timeByUser = {};
    wsLogs.forEach(log => {
        const userName = getUserName(log.user_id);
        const hours = log.duration_ms / (1000 * 60 * 60);
        timeByUser[userName] = (timeByUser[userName] || 0) + hours;
    });

    const workload = {};
    wsTasks.filter(t => ['todo', 'doing'].includes(t.status)).forEach(t => {
        if (!t.assignees || t.assignees.length === 0) {
            workload['Unassigned'] = (workload['Unassigned'] || 0) + 1;
        } else {
            t.assignees.forEach(uid => {
                const uName = getUserName(uid);
                workload[uName] = (workload[uName] || 0) + 1;
            });
        }
    });

    const velocity = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) { 
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        velocity[d.toISOString().split('T')[0]] = 0;
    }
    wsTasks.filter(t => ['done', 'complete'].includes(t.status) && t.completed_at).forEach(t => {
        const dateStr = t.completed_at.split('T')[0];
        if (velocity[dateStr] !== undefined) velocity[dateStr]++;
    });

    const recurring = wsTasks.filter(t => t.status === 'recurring' && t.counter > 0)
                             .sort((a,b) => b.counter - a.counter).slice(0, 5);
    const recurringLabels = recurring.map(t => sanitize(t.title));
    const recurringData = recurring.map(t => t.counter);

    const colors = ['rgba(0, 82, 204, 0.7)', 'rgba(54, 179, 126, 0.7)', 'rgba(255, 153, 31, 0.7)', 'rgba(222, 53, 11, 0.7)', 'rgba(101, 84, 192, 0.7)'];
    
    const buildChart = (id, type, labels, data, datasetLabel, colorIndex) => {
        if (chartInstances[id]) chartInstances[id].destroy(); 
        const ctx = document.getElementById(id).getContext('2d');
        const bgColors = type === 'pie' ? colors : colors[colorIndex];
        
        chartInstances[id] = new Chart(ctx, {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: datasetLabel,
                    data: data,
                    backgroundColor: bgColors,
                    borderColor: type === 'pie' ? '#fff' : bgColors.replace('0.7', '1'),
                    borderWidth: 1,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: type === 'pie', position: 'right' } },
                scales: type === 'pie' ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        });
    };

    buildChart('chart-time-allocation', 'pie', Object.keys(timeByUser), Object.values(timeByUser).map(v => v.toFixed(2)), 'Hours', 0);
    buildChart('chart-workload', 'bar', Object.keys(workload), Object.values(workload), 'Active Tasks', 1);
    buildChart('chart-velocity', 'line', Object.keys(velocity).map(d => d.slice(5)), Object.values(velocity), 'Tasks Completed', 0);
    buildChart('chart-recurring', 'bar', recurringLabels, recurringData, 'Total Repetitions', 2);
}

function renderDetailedTimeReport() {
    const timeframe = document.getElementById('report-timeframe').value;
    const groupBy = document.getElementById('report-groupby').value;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - today.getDay());
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    let filteredLogs = timeLogs.filter(l => l.workspace_id === currentWorkspaceId);
    
    if (timeframe !== 'all') {
        filteredLogs = filteredLogs.filter(l => {
            if (!l.created_at) return false;
            const logDate = new Date(l.created_at);
            if (timeframe === 'today') return logDate >= today;
            if (timeframe === 'week') return logDate >= startOfWeek;
            if (timeframe === 'month') return logDate >= startOfMonth;
            if (timeframe === 'year') return logDate >= startOfYear;
            return true;
        });
    }

    const aggregated = {};
    
    filteredLogs.forEach(log => {
        const ms = parseInt(log.duration_ms, 10);
        const d = log.created_at ? new Date(log.created_at) : new Date();
        const sessStr = `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
        
        const pObj = projects.find(p => p.id === log.project_id);
        const pName = pObj ? pObj.name : 'Unknown Project';
        const uName = getUserName(log.user_id);
        const tObj = tasks.find(t => t.id === log.task_id);
        const tName = tObj ? tObj.title : 'Deleted/Unknown Task';
        
        if (groupBy === 'user') {
            if (!aggregated[uName]) aggregated[uName] = { total: 0, sub: {} };
            aggregated[uName].total += ms;
            if (!aggregated[uName].sub[pName]) aggregated[uName].sub[pName] = { total: 0, sub: {} };
            aggregated[uName].sub[pName].total += ms;
            if (!aggregated[uName].sub[pName].sub[tName]) aggregated[uName].sub[pName].sub[tName] = { total: 0, sessions: [] };
            aggregated[uName].sub[pName].sub[tName].total += ms;
            aggregated[uName].sub[pName].sub[tName].sessions.push({ str: sessStr, ms: ms });
        } else {
            if (!aggregated[pName]) aggregated[pName] = { total: 0, sub: {} };
            aggregated[pName].total += ms;
            if (!aggregated[pName].sub[uName]) aggregated[pName].sub[uName] = { total: 0, sub: {} };
            aggregated[pName].sub[uName].total += ms;
            if (!aggregated[pName].sub[uName].sub[tName]) aggregated[pName].sub[uName].sub[tName] = { total: 0, sessions: [] };
            aggregated[pName].sub[uName].sub[tName].total += ms;
            aggregated[pName].sub[uName].sub[tName].sessions.push({ str: sessStr, ms: ms });
        }
    });

    let html = '';
    if (Object.keys(aggregated).length === 0) {
        html = '<p style="color: #5e6c84; font-size: 14px; text-align: center; padding: 20px;">No time logged for this timeframe.</p>';
    } else {
        const sortedL1 = Object.keys(aggregated).sort((a,b) => aggregated[b].total - aggregated[a].total);
        sortedL1.forEach(l1 => {
            const l1Data = aggregated[l1];
            html += `
            <details style="margin-bottom: 8px; border: 1px solid #dfe1e6; border-radius: 6px; overflow: hidden;">
                <summary style="background: #f4f5f7; padding: 12px; cursor: pointer; font-weight: bold; color: #172b4d; display: flex; justify-content: space-between; outline: none;">
                    <span>${sanitize(l1)}</span>
                    <span style="color: #0052cc;">${formatTime(l1Data.total)}</span>
                </summary>
                <div style="padding: 10px 15px;">
            `;
            
            const sortedL2 = Object.keys(l1Data.sub).sort((a,b) => l1Data.sub[b].total - l1Data.sub[a].total);
            sortedL2.forEach(l2 => {
                const l2Data = l1Data.sub[l2];
                html += `
                <details style="margin-bottom: 6px; border-left: 2px solid #ebecf0; padding-left: 10px;">
                    <summary style="padding: 6px; cursor: pointer; font-weight: 600; color: #42526e; display: flex; justify-content: space-between; border-bottom: 1px solid #ebecf0; outline: none;">
                        <span>${sanitize(l2)}</span>
                        <span style="color: #36b37e;">${formatTime(l2Data.total)}</span>
                    </summary>
                    <div style="padding: 6px 10px 10px 15px;">
                `;
                
                const sortedL3 = Object.keys(l2Data.sub).sort((a,b) => l2Data.sub[b].total - l2Data.sub[a].total);
                html += `<div style="display: flex; flex-direction: column; gap: 4px;">`;
                sortedL3.forEach(l3 => {
                    const tData = l2Data.sub[l3];
                    html += `
                    <details style="border-bottom: 1px dashed #ebecf0; padding: 4px 0;">
                        <summary style="cursor: pointer; display: flex; justify-content: space-between; outline: none; color: #5e6c84; font-size: 13px;">
                            <span>${sanitize(l3)}</span>
                            <span style="color: #172b4d; font-family: monospace;">${formatTime(tData.total)}</span>
                        </summary>
                        <div style="padding-left: 15px; font-size: 11px; margin-top: 4px;">`;
                    
                    tData.sessions.forEach(sess => {
                        html += `<div style="display: flex; justify-content: space-between; color: #8993a4; padding: 2px 0;">
                            <span>↳ ${sess.str}</span>
                            <span style="font-family: monospace;">${formatTime(sess.ms)}</span>
                        </div>`;
                    });
                    html += `</div></details>`;
                });
                html += `</div></div></details>`;
            });
            
            html += `</div></details>`;
        });
    }
    document.getElementById('detailed-time-container').innerHTML = html;
}

// --- CONTEXTUAL COMMENTS / NOTES ENGINE ---
function renderTaskComments(taskId) {
    const list = document.getElementById('task-comments-list');
    const taskComms = comments.filter(c => c.task_id === taskId);
    const myId = getActiveUserObj().id;
    
    list.innerHTML = taskComms.map(c => {
        const isMine = c.user_id === myId;
        const actionsHtml = isMine ? `
            <div style="display:flex; gap: 8px; align-items: center; margin-left: 10px;">
                <button type="button" style="background:none; border:none; padding:0; cursor:pointer; color:#5e6c84; font-size: 14px;" onclick="triggerEditComment('${c.id}')" title="Edit">✎</button>
                <button type="button" style="background:none; border:none; padding:0; cursor:pointer; color:#de350b; font-size: 14px;" onclick="triggerDeleteComment('${c.id}')" title="Delete">✕</button>
            </div>
        ` : '';

        return `
        <div style="background: #f4f5f7; padding: 8px 12px; border-radius: 6px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; align-items: center;">
                <strong style="color: #172b4d;">${sanitize(getUserName(c.user_id))}</strong>
                <div style="display: flex; align-items: center;">
                    <span style="color: #5e6c84; font-size: 11px;">${new Date(c.created_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
                    ${actionsHtml}
                </div>
            </div>
            <div style="color: #172b4d; line-height: 1.4;">${linkify(sanitize(c.content))}</div>
        </div>`;
    }).join('') || '<div style="color: #5e6c84; font-size: 13px; text-align: center;">No activity recorded yet.</div>';
    
    list.scrollTop = list.scrollHeight;
}

function renderProjectComments(projectId) {
    const list = document.getElementById('project-comments-list');
    const projComms = comments.filter(c => c.project_id === projectId && !c.task_id);
    const myId = getActiveUserObj().id;
    
    list.innerHTML = projComms.map(c => {
        const isMine = c.user_id === myId;
        const actionsHtml = isMine ? `
            <div style="display:flex; gap: 8px; align-items: center; margin-left: 10px;">
                <button type="button" style="background:none; border:none; padding:0; cursor:pointer; color:#5e6c84; font-size: 14px;" onclick="triggerEditComment('${c.id}')" title="Edit">✎</button>
                <button type="button" style="background:none; border:none; padding:0; cursor:pointer; color:#de350b; font-size: 14px;" onclick="triggerDeleteComment('${c.id}')" title="Delete">✕</button>
            </div>
        ` : '';

        return `
        <div style="background: #f4f5f7; padding: 8px 12px; border-radius: 6px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; align-items: center;">
                <strong style="color: #172b4d;">${sanitize(getUserName(c.user_id))}</strong>
                <div style="display: flex; align-items: center;">
                    <span style="color: #5e6c84; font-size: 11px;">${new Date(c.created_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
                    ${actionsHtml}
                </div>
            </div>
            <div style="color: #172b4d; line-height: 1.4;">${linkify(sanitize(c.content))}</div>
        </div>`;
    }).join('') || '<div style="color: #5e6c84; font-size: 13px; text-align: center;">No project notes yet.</div>';
    
    list.scrollTop = list.scrollHeight;
}

function postTaskComment() {
    const input = document.getElementById('new-task-comment');
    const content = input.value.trim();
    if (!content || !draftTask) return;
    
    const targetId = draftSubtaskId || draftTask.id;
    
    const newComment = {
        id: generateUUID(),
        workspace_id: currentWorkspaceId,
        project_id: draftTask.project_id,
        task_id: targetId,
        user_id: getActiveUserObj().id,
        content: content,
        created_at: new Date().toISOString()
    };
    
    comments.push(newComment);
    input.value = '';
    renderTaskComments(targetId);
    apiCall('/comments', 'POST', newComment);
}

function postProjectComment() {
    const input = document.getElementById('new-project-comment');
    const content = input.value.trim();
    if (!content || !contextTargetProjectId) return;
    
    const newComment = {
        id: generateUUID(),
        workspace_id: currentWorkspaceId,
        project_id: contextTargetProjectId,
        task_id: null,
        user_id: getActiveUserObj().id,
        content: content,
        created_at: new Date().toISOString()
    };
    
    comments.push(newComment);
    input.value = '';
    renderProjectComments(contextTargetProjectId);
    apiCall('/comments', 'POST', newComment);
}

function triggerEditComment(id) {
    const c = comments.find(x => x.id === id);
    if (!c) return;
    
    document.getElementById('edit-comment-id').value = id;
    document.getElementById('edit-comment-input').value = c.content;
    document.getElementById('edit-comment-modal').showModal();
}

document.getElementById('edit-comment-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const id = document.getElementById('edit-comment-id').value;
    const newContent = document.getElementById('edit-comment-input').value.trim();
    const c = comments.find(x => x.id === id);
    
    if (c && newContent) {
        c.content = newContent;
        apiCall(`/comments/${id}`, 'PUT', { content: c.content });
        
        if (c.task_id) renderTaskComments(c.task_id);
        else if (c.project_id) renderProjectComments(c.project_id);
    }
    document.getElementById('edit-comment-modal').close();
});

function triggerDeleteComment(id) {
    if (!confirm("Are you sure you want to delete this comment? This cannot be undone.")) return;
    
    const c = comments.find(x => x.id === id);
    if (!c) return;
    
    comments = comments.filter(x => x.id !== id);
    apiCall(`/comments/${id}`, 'DELETE');
    
    if (c.task_id) renderTaskComments(c.task_id);
    else if (c.project_id) renderProjectComments(c.project_id);
}

// Global Click Listener to close UI dropdowns safely
document.addEventListener('click', (e) => {
    if (!e.target.closest('#pill-urgency') && !e.target.closest('#urgency-dropdown')) {
        const d = document.getElementById('urgency-dropdown');
        if (d) d.style.display = 'none';
    }
    if (!e.target.closest('#pill-status') && !e.target.closest('#status-dropdown')) {
        const d = document.getElementById('status-dropdown');
        if (d) d.style.display = 'none';
    }
});
