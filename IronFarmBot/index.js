const mineflayer = require('mineflayer')
const Vec3 = require('vec3')
const express = require('express')
const config = require('./config.json')

let isEating = false
let moveInterval = null
let sleepInterval = null
let sessionStart = Date.now()
const TP_STEP = 8       // blocks per teleport hop
const TP_DELAY = 200    // ms between hops
const ARRIVE_DIST = 2   // stop when within this many blocks

// ── Shared state for the dashboard ────────────────────────────────────────
const state = {
    status: 'Connecting...',
    username: config.username,
    server: `${config.host}:${config.port}`,
    position: { x: 0, y: 0, z: 0 },
    health: 20,
    food: 20,
    sleeping: false,
    autoSleep: false,
    uptime: 0,
    log: []
}

function addLog(msg) {
    const time = new Date().toLocaleTimeString()
    state.log.unshift(`[${time}] ${msg}`)
    if (state.log.length > 80) state.log.pop()
}

// ── Express dashboard on port 5000 ────────────────────────────────────────
const app = express()

app.get('/api/status', (req, res) => {
    state.uptime = Math.floor((Date.now() - sessionStart) / 1000)
    res.json(state)
})

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IronFarmBot Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f0f; color: #e0e0e0; font-family: 'Segoe UI', monospace; min-height: 100vh; }
  header { background: #1a1a2e; padding: 18px 28px; display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #4ade80; }
  header img { width: 36px; height: 36px; image-rendering: pixelated; }
  header h1 { font-size: 1.4rem; color: #4ade80; letter-spacing: 1px; }
  header .server { color: #888; font-size: 0.85rem; margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; padding: 20px; }
  .card { background: #1a1a2e; border-radius: 10px; padding: 16px; border: 1px solid #2a2a4e; }
  .card .label { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .card .value { font-size: 1.5rem; font-weight: bold; color: #4ade80; }
  .card .value.red { color: #f87171; }
  .card .value.yellow { color: #facc15; }
  .card .value.blue { color: #60a5fa; }
  .bar-wrap { background: #0f0f0f; border-radius: 6px; height: 10px; margin-top: 8px; overflow: hidden; }
  .bar { height: 100%; border-radius: 6px; transition: width 0.5s; }
  .bar.green { background: #4ade80; }
  .bar.yellow { background: #facc15; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .status-dot.online { background: #4ade80; box-shadow: 0 0 8px #4ade80; animation: pulse 2s infinite; }
  .status-dot.offline { background: #f87171; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .log-section { margin: 0 20px 20px; background: #1a1a2e; border-radius: 10px; border: 1px solid #2a2a4e; overflow: hidden; }
  .log-header { padding: 10px 16px; background: #0f0f0f; font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .log-body { padding: 10px 16px; font-size: 0.78rem; color: #a0a0a0; max-height: 320px; overflow-y: auto; font-family: monospace; line-height: 1.7; }
  .log-body .entry { border-bottom: 1px solid #1e1e3a; padding: 2px 0; }
  .coords { color: #c084fc; font-size: 1rem; }
  .refresh-note { text-align: center; color: #444; font-size: 0.7rem; padding-bottom: 16px; }
</style>
</head>
<body>
<header>
  <div style="width:36px;height:36px;background:#4ade80;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;">⛏️</div>
  <h1>IronFarmBot</h1>
  <div class="server" id="server-label"></div>
</header>

<div class="grid" id="cards">
  <div class="card">
    <div class="label">Status</div>
    <div class="value" id="status-val"><span class="status-dot offline" id="dot"></span><span id="status-text">Loading...</span></div>
  </div>
  <div class="card">
    <div class="label">Position</div>
    <div class="coords" id="pos-val">—</div>
  </div>
  <div class="card">
    <div class="label">Health</div>
    <div class="value green" id="health-val">20</div>
    <div class="bar-wrap"><div class="bar green" id="health-bar" style="width:100%"></div></div>
  </div>
  <div class="card">
    <div class="label">Food</div>
    <div class="value yellow" id="food-val">20</div>
    <div class="bar-wrap"><div class="bar yellow" id="food-bar" style="width:100%"></div></div>
  </div>
  <div class="card">
    <div class="label">Uptime</div>
    <div class="value blue" id="uptime-val">0s</div>
  </div>
  <div class="card">
    <div class="label">Auto Sleep</div>
    <div class="value" id="sleep-val">OFF</div>
  </div>
</div>

<div class="log-section">
  <div class="log-header">📋 Activity Log</div>
  <div class="log-body" id="log"></div>
</div>
<div class="refresh-note">Auto-refreshes every 3 seconds</div>

<script>
function fmt(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60
  if (h>0) return h+'h '+m+'m '+sec+'s'
  if (m>0) return m+'m '+sec+'s'
  return sec+'s'
}
async function refresh() {
  try {
    const r = await fetch('/api/status')
    const d = await r.json()
    document.getElementById('server-label').textContent = d.server
    const online = d.status === 'Online'
    document.getElementById('dot').className = 'status-dot ' + (online ? 'online' : 'offline')
    document.getElementById('status-text').textContent = d.status
    document.getElementById('pos-val').textContent = \`X:\${Math.floor(d.position.x)} Y:\${Math.floor(d.position.y)} Z:\${Math.floor(d.position.z)}\`
    document.getElementById('health-val').textContent = d.health
    document.getElementById('health-bar').style.width = (d.health/20*100)+'%'
    document.getElementById('food-val').textContent = d.food
    document.getElementById('food-bar').style.width = (d.food/20*100)+'%'
    document.getElementById('uptime-val').textContent = fmt(d.uptime)
    document.getElementById('sleep-val').textContent = d.sleeping ? '😴 Sleeping' : (d.autoSleep ? 'ON' : 'OFF')
    document.getElementById('sleep-val').style.color = d.autoSleep ? '#4ade80' : '#888'
    document.getElementById('log').innerHTML = d.log.map(l => \`<div class="entry">\${l}</div>\`).join('')
  } catch(e) {}
}
refresh()
setInterval(refresh, 3000)
</script>
</body>
</html>`)
})

app.listen(5000, '0.0.0.0', () => {
    console.log('[WEB] Dashboard running on port 5000')
})

function createBot() {
    const bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        version: config.version || false,
        auth: 'offline'
    })

    bot.on('login', () => {
        console.log(`[BOT] Logged in as ${bot.username}`)
        state.status = 'Online'
        addLog(`Logged in as ${bot.username}`)
    })

    bot.on('spawn', () => {
        const p = bot.entity.position
        console.log(`[BOT] Spawned at ${p}`)
        state.status = 'Online'
        state.position = { x: p.x, y: p.y, z: p.z }
        isEating = false
        addLog(`Spawned at X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
    })

    // Keep position updated every 2s
    setInterval(() => {
        if (bot.entity) {
            const p = bot.entity.position
            state.position = { x: p.x, y: p.y, z: p.z }
            state.health = Math.round(bot.health)
            state.food = Math.round(bot.food)
            state.sleeping = bot.isSleeping
        }
    }, 2000)

    // ── Auto-eat when food ≤ 6 (3 bars) ───────────────────────────────────
    bot.on('health', async () => {
        state.health = Math.round(bot.health)
        state.food = Math.round(bot.food)
        if (bot.food <= 6 && !isEating) await tryEat()
    })

    async function tryEat() {
        try {
            const mcData = require('minecraft-data')(bot.version)
            const foodIds = new Set(Object.values(mcData.foods).map(f => f.id))
            const foodItem = bot.inventory.items().find(item => foodIds.has(item.type))
            if (!foodItem) { console.log('[EAT] No food in inventory'); return }
            isEating = true
            console.log(`[EAT] Eating ${foodItem.name} (food: ${bot.food})`)
            await bot.equip(foodItem, 'hand')
            await bot.consume()
            console.log(`[EAT] Done. Food: ${bot.food}`)
        } catch (e) {
            console.log(`[EAT] Error: ${e.message}`)
        } finally {
            isEating = false
        }
    }

    // ── Teleport one step toward a target Vec3. Returns true when arrived ─
    function stepToward(target) {
        const pos = bot.entity.position
        const dx = target.x - pos.x
        const dy = target.y - pos.y
        const dz = target.z - pos.z
        const dist3d = Math.sqrt(dx * dx + dy * dy + dz * dz)

        if (dist3d <= ARRIVE_DIST) return true  // arrived

        const ratio = Math.min(TP_STEP, dist3d) / dist3d
        const nextX = pos.x + dx * ratio
        const nextY = pos.y + dy * ratio
        const nextZ = pos.z + dz * ratio

        bot.chat(`/tp ${bot.username} ${nextX.toFixed(3)} ${nextY.toFixed(3)} ${nextZ.toFixed(3)}`)
        console.log(`[TP] -> X:${nextX.toFixed(1)} Y:${nextY.toFixed(1)} Z:${nextZ.toFixed(1)} | dist: ${dist3d.toFixed(1)}`)
        return false
    }

    // ── Stop any movement ─────────────────────────────────────────────────
    function stopMoving(silent) {
        if (moveInterval) { clearInterval(moveInterval); moveInterval = null }
        if (!silent) console.log('[BOT] Movement stopped')
    }

    // ── Nearest boat ───────────────────────────────────────────────────────
    function getNearestBoat() {
        const boats = Object.values(bot.entities).filter(e =>
            e.name && e.name.toLowerCase().includes('boat')
        )
        if (!boats.length) return null
        boats.sort((a, b) =>
            bot.entity.position.distanceTo(a.position) -
            bot.entity.position.distanceTo(b.position)
        )
        return boats[0]
    }

    // ── Chat commands ──────────────────────────────────────────────────────
    bot.on('chat', async (username, message) => {
        if (username === bot.username) return
        const msg = message.trim()
        console.log(`[CHAT] <${username}> ${msg}`)
        addLog(`<${username}> ${msg}`)

        // Walk to X Y Z
        const walkMatch = msg.match(/^IronFarmBot walk to\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/i)
        if (walkMatch) {
            const x = parseFloat(walkMatch[1])
            const y = parseFloat(walkMatch[2])
            const z = parseFloat(walkMatch[3])
            const target = new Vec3(x, y, z)
            stopMoving(true)
            bot.chat(`Going to X:${x} Y:${y} Z:${z}!`)
            console.log(`[NAV] Target: X:${x} Y:${y} Z:${z}`)

            moveInterval = setInterval(() => {
                try {
                    const arrived = stepToward(target)
                    if (arrived) {
                        stopMoving(true)
                        bot.chat(`Arrived at X:${x} Y:${y} Z:${z}!`)
                        console.log('[NAV] Arrived at destination')
                    }
                } catch (e) {
                    console.log(`[NAV] Error: ${e.message}`)
                }
            }, TP_DELAY)
            return
        }

        // Stop walking
        if (/^IronFarmBot stop walking$/i.test(msg)) {
            stopMoving()
            bot.chat('Stopped!')
            return
        }

        // Follow me
        if (/^IronFarmBot follow me$/i.test(msg)) {
            const player = bot.players[username]
            if (!player || !player.entity) {
                bot.chat(`I can't see you, ${username}!`)
                return
            }
            const dist = bot.entity.position.distanceTo(player.entity.position)
            if (dist > 50) {
                bot.chat(`You're too far away! (${Math.floor(dist)} blocks)`)
                return
            }
            stopMoving(true)
            bot.chat(`Following you, ${username}!`)
            console.log(`[FOLLOW] Following ${username}`)

            moveInterval = setInterval(() => {
                try {
                    const target = bot.players[username]
                    if (!target || !target.entity) return
                    stepToward(target.entity.position)
                } catch (e) {
                    console.log(`[FOLLOW] Error: ${e.message}`)
                }
            }, TP_DELAY)
            return
        }

        // Stop following
        if (/^IronFarmBot stop following me$/i.test(msg)) {
            stopMoving()
            bot.chat(`Stopped following you, ${username}!`)
            return
        }

        // Enter boat
        if (/^IronFarmBot enter the boat$/i.test(msg)) {
            const boat = getNearestBoat()
            if (!boat) { bot.chat('No boat nearby!'); return }
            try {
                bot.mount(boat)
                bot.chat('Entering the boat!')
                console.log(`[BOAT] Mounted at ${boat.position}`)
            } catch (e) {
                bot.chat('Could not enter the boat.')
                console.log(`[BOAT] Error: ${e.message}`)
            }
            return
        }

        // Leave boat
        if (/^IronFarmBot leave the boat$/i.test(msg)) {
            if (bot.vehicle) {
                bot.dismount()
                bot.chat('Leaving the boat!')
                console.log('[BOAT] Dismounted')
            } else {
                bot.chat("I'm not in a boat!")
            }
            return
        }

        // ── Discard all roses (poppies) from nearby chests ──────────────────
        if (/^IronFarmBot Discard all roses$/i.test(msg)) {
            bot.chat('Looking for roses in nearby chests...')
            console.log('[ROSES] Starting rose discard task')
            discardRoses().then(result => {
                bot.chat(result)
            }).catch(e => {
                bot.chat(`Error: ${e.message}`)
                console.log(`[ROSES] Error: ${e.message}`)
            })
            return
        }

        // ── Count iron in nearby chests ──────────────────────────────────────
        if (/^IronFarmBot count iron$/i.test(msg)) {
            bot.chat('Counting iron in nearby chests...')
            countItemInChests('iron_ingot', 'Iron Ingots').then(result => {
                bot.chat(result)
            }).catch(e => bot.chat(`Error: ${e.message}`))
            return
        }

        // ── Chest status (what's inside nearby chests) ───────────────────────
        if (/^IronFarmBot chest status$/i.test(msg)) {
            bot.chat('Scanning nearby chests...')
            chestStatus().then(lines => {
                lines.forEach(l => bot.chat(l))
            }).catch(e => bot.chat(`Error: ${e.message}`))
            return
        }

        // ── Auto sleep on/off ────────────────────────────────────────────────
        if (/^IronFarmBot auto sleep on$/i.test(msg)) {
            if (sleepInterval) {
                bot.chat('Auto sleep is already on!')
                return
            }
            bot.chat('Auto sleep ON — I will sleep in the nearest bed at night.')
            console.log('[SLEEP] Auto sleep enabled')
            state.autoSleep = true
            addLog('Auto sleep ON')
            sleepInterval = setInterval(autoSleepTick, 4000)
            return
        }

        if (/^IronFarmBot auto sleep off$/i.test(msg)) {
            if (!sleepInterval) {
                bot.chat('Auto sleep is already off!')
                return
            }
            clearInterval(sleepInterval)
            sleepInterval = null
            state.autoSleep = false
            addLog('Auto sleep OFF')
            if (bot.isSleeping) bot.wake()
            bot.chat('Auto sleep OFF.')
            console.log('[SLEEP] Auto sleep disabled')
            return
        }

        // ── Farm report ──────────────────────────────────────────────────────
        if (/^IronFarmBot farm report$/i.test(msg)) {
            farmReport().then(lines => {
                lines.forEach(l => bot.chat(l))
            }).catch(e => bot.chat(`Error: ${e.message}`))
            return
        }

        // ── Sort chests (iron in first, roses in second) ─────────────────────
        if (/^IronFarmBot sort chests$/i.test(msg)) {
            bot.chat('Sorting chests, please wait...')
            sortChests().then(result => {
                bot.chat(result)
            }).catch(e => {
                bot.chat(`Error sorting: ${e.message}`)
                console.log(`[SORT] Error: ${e.message}`)
            })
            return
        }

        // Misc
        if (msg === 'hello') bot.chat(`Hello, ${username}!`)
        if (msg === 'pos') {
            const p = bot.entity.position
            bot.chat(`X:${Math.floor(p.x)} Y:${Math.floor(p.y)} Z:${Math.floor(p.z)}`)
        }
        if (msg === 'health') bot.chat(`Health: ${bot.health} | Food: ${bot.food}`)
    })

    // ── Find nearby chest blocks ───────────────────────────────────────────
    function findNearbyChests(maxDist) {
        const mcData = require('minecraft-data')(bot.version)
        const chestIds = []
        for (const name of ['chest', 'trapped_chest', 'barrel']) {
            if (mcData.blocksByName[name]) chestIds.push(mcData.blocksByName[name].id)
        }
        return bot.findBlocks({ matching: chestIds, maxDistance: maxDist || 10, count: 64 })
    }

    // ── Discard roses: pull all poppies from nearby chests then toss them ──
    async function discardRoses() {
        const mcData = require('minecraft-data')(bot.version)
        const poppyId = mcData.itemsByName.poppy ? mcData.itemsByName.poppy.id : null
        if (!poppyId) return 'Could not find poppy item in game data.'

        const chestPositions = findNearbyChests(12)
        if (!chestPositions.length) return 'No chests found nearby!'

        let totalTaken = 0
        const visited = new Set()

        for (const pos of chestPositions) {
            const key = `${pos.x},${pos.y},${pos.z}`
            if (visited.has(key)) continue
            visited.add(key)

            const block = bot.blockAt(pos)
            if (!block) continue

            let container
            try {
                container = await bot.openContainer(block)
                await new Promise(r => setTimeout(r, 300))

                const poppies = container.containerItems().filter(i => i.type === poppyId)
                for (const item of poppies) {
                    try {
                        await container.withdraw(item.type, null, item.count)
                        totalTaken += item.count
                        console.log(`[ROSES] Took ${item.count} poppies from chest at ${pos}`)
                        await new Promise(r => setTimeout(r, 150))
                    } catch (e) {
                        console.log(`[ROSES] Withdraw error: ${e.message}`)
                    }
                }
                container.close()
                await new Promise(r => setTimeout(r, 200))
            } catch (e) {
                console.log(`[ROSES] Could not open chest at ${pos}: ${e.message}`)
                if (container) try { container.close() } catch (_) {}
            }
        }

        if (totalTaken === 0) return 'No roses found in nearby chests!'

        // Toss all poppies from bot inventory
        await new Promise(r => setTimeout(r, 300))
        const invPoppies = bot.inventory.items().filter(i => i.type === poppyId)
        let tossed = 0
        for (const item of invPoppies) {
            try {
                await bot.toss(item.type, null, item.count)
                tossed += item.count
                await new Promise(r => setTimeout(r, 100))
            } catch (e) {
                console.log(`[ROSES] Toss error: ${e.message}`)
            }
        }

        console.log(`[ROSES] Done. Taken: ${totalTaken}, Tossed: ${tossed}`)
        return `Done! Removed ${tossed} roses from ${chestPositions.length} chests.`
    }

    // ── Count a specific item across nearby chests ─────────────────────────
    async function countItemInChests(itemName, label) {
        const mcData = require('minecraft-data')(bot.version)
        const item = mcData.itemsByName[itemName]
        if (!item) return `Unknown item: ${itemName}`

        const chestPositions = findNearbyChests(12)
        if (!chestPositions.length) return 'No chests found nearby!'

        let total = 0
        const visited = new Set()

        for (const pos of chestPositions) {
            const key = `${pos.x},${pos.y},${pos.z}`
            if (visited.has(key)) continue
            visited.add(key)

            const block = bot.blockAt(pos)
            if (!block) continue
            let container
            try {
                container = await bot.openContainer(block)
                await new Promise(r => setTimeout(r, 300))
                const count = container.containerItems()
                    .filter(i => i.type === item.id)
                    .reduce((sum, i) => sum + i.count, 0)
                total += count
                container.close()
                await new Promise(r => setTimeout(r, 150))
            } catch (e) {
                if (container) try { container.close() } catch (_) {}
            }
        }
        return `${label || itemName}: ${total} total in ${chestPositions.length} nearby chests.`
    }

    // ── Show item summary across nearby chests ─────────────────────────────
    async function chestStatus() {
        const chestPositions = findNearbyChests(12)
        if (!chestPositions.length) return ['No chests found nearby!']

        const totals = {}
        const visited = new Set()

        for (const pos of chestPositions) {
            const key = `${pos.x},${pos.y},${pos.z}`
            if (visited.has(key)) continue
            visited.add(key)

            const block = bot.blockAt(pos)
            if (!block) continue
            let container
            try {
                container = await bot.openContainer(block)
                await new Promise(r => setTimeout(r, 300))
                for (const item of container.containerItems()) {
                    totals[item.name] = (totals[item.name] || 0) + item.count
                }
                container.close()
                await new Promise(r => setTimeout(r, 150))
            } catch (e) {
                if (container) try { container.close() } catch (_) {}
            }
        }

        const entries = Object.entries(totals)
        if (!entries.length) return ['Nearby chests are empty.']
        return entries.map(([name, count]) => `${name}: ${count}`)
    }

    // ── Farm report: uptime + chest summary ────────────────────────────────
    async function farmReport() {
        const uptimeMs = Date.now() - sessionStart
        const totalSec = Math.floor(uptimeMs / 1000)
        const h = Math.floor(totalSec / 3600)
        const m = Math.floor((totalSec % 3600) / 60)
        const s = totalSec % 60
        const uptime = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`

        const mcData = require('minecraft-data')(bot.version)
        const chestPositions = findNearbyChests(12)
        const visited = new Set()
        const totals = {}

        for (const pos of chestPositions) {
            const key = `${pos.x},${pos.y},${pos.z}`
            if (visited.has(key)) continue
            visited.add(key)
            const block = bot.blockAt(pos)
            if (!block) continue
            let container
            try {
                container = await bot.openContainer(block)
                await new Promise(r => setTimeout(r, 300))
                for (const item of container.containerItems()) {
                    totals[item.name] = (totals[item.name] || 0) + item.count
                }
                container.close()
                await new Promise(r => setTimeout(r, 150))
            } catch (e) {
                if (container) try { container.close() } catch (_) {}
            }
        }

        const iron = totals['iron_ingot'] || 0
        const roses = totals['poppy'] || 0
        const lines = [
            `=== IronFarmBot Report ===`,
            `Uptime: ${uptime}`,
            `Chests scanned: ${visited.size}`,
            `Iron ingots: ${iron}`,
            `Roses (poppy): ${roses}`,
        ]
        const others = Object.entries(totals).filter(([n]) => n !== 'iron_ingot' && n !== 'poppy')
        if (others.length) lines.push(`Other: ${others.map(([n, c]) => `${n}x${c}`).join(', ')}`)
        return lines
    }

    // ── Sort chests: iron first, roses last ────────────────────────────────
    async function sortChests() {
        const mcData = require('minecraft-data')(bot.version)
        const ironId = mcData.itemsByName.iron_ingot?.id
        const poppyId = mcData.itemsByName.poppy?.id

        const chestPositions = findNearbyChests(12)
        if (chestPositions.length < 2) return 'Need at least 2 chests nearby to sort!'

        const visited = new Set()
        const uniquePositions = []
        for (const pos of chestPositions) {
            const key = `${pos.x},${pos.y},${pos.z}`
            if (!visited.has(key)) { visited.add(key); uniquePositions.push(pos) }
        }

        // Step 1: collect everything from all chests into bot inventory
        console.log('[SORT] Collecting all items from chests...')
        for (const pos of uniquePositions) {
            const block = bot.blockAt(pos)
            if (!block) continue
            let container
            try {
                container = await bot.openContainer(block)
                await new Promise(r => setTimeout(r, 300))
                const items = [...container.containerItems()]
                for (const item of items) {
                    try {
                        await container.withdraw(item.type, null, item.count)
                        await new Promise(r => setTimeout(r, 100))
                    } catch (_) {}
                }
                container.close()
                await new Promise(r => setTimeout(r, 200))
            } catch (e) {
                if (container) try { container.close() } catch (_) {}
            }
        }

        await new Promise(r => setTimeout(r, 400))

        // Step 2: separate inventory into iron, roses, other
        const invItems = bot.inventory.items()
        const ironItems  = invItems.filter(i => i.type === ironId)
        const roseItems  = invItems.filter(i => i.type === poppyId)
        const otherItems = invItems.filter(i => i.type !== ironId && i.type !== poppyId)

        // Step 3: put iron into first chests, roses into last chest(s), others fill remaining
        const ironChests  = uniquePositions.slice(0, Math.ceil(uniquePositions.length / 2))
        const roseChests  = uniquePositions.slice(Math.ceil(uniquePositions.length / 2))

        async function depositItems(positions, itemList) {
            let remaining = [...itemList]
            for (const pos of positions) {
                if (!remaining.length) break
                const block = bot.blockAt(pos)
                if (!block) continue
                let container
                try {
                    container = await bot.openContainer(block)
                    await new Promise(r => setTimeout(r, 300))
                    for (const item of remaining) {
                        try {
                            await container.deposit(item.type, null, item.count)
                            await new Promise(r => setTimeout(r, 100))
                        } catch (_) {}
                    }
                    container.close()
                    await new Promise(r => setTimeout(r, 200))
                } catch (e) {
                    if (container) try { container.close() } catch (_) {}
                }
                remaining = bot.inventory.items().filter(i =>
                    itemList.some(orig => orig.type === i.type)
                )
            }
        }

        await depositItems(ironChests, ironItems)
        await depositItems(roseChests, roseItems)
        // dump remaining (other) back into any chest
        if (otherItems.length) await depositItems(uniquePositions, otherItems)

        const ironCount = ironItems.reduce((s, i) => s + i.count, 0)
        const roseCount = roseItems.reduce((s, i) => s + i.count, 0)
        console.log(`[SORT] Done. Iron: ${ironCount}, Roses: ${roseCount}`)
        return `Sorted! Iron (${ironCount}) -> first ${ironChests.length} chest(s). Roses (${roseCount}) -> last ${roseChests.length} chest(s).`
    }

    // ── Auto sleep tick (runs every 4s when enabled) ───────────────────────
    async function autoSleepTick() {
        try {
            const timeOfDay = bot.time.timeOfDay
            // Night = 12541–23458, thunder also counts
            const isNight = timeOfDay >= 12541 && timeOfDay <= 23458
            const isThunder = bot.thunderState > 0

            if ((isNight || isThunder) && !bot.isSleeping) {
                // Find nearest bed (any color)
                const mcData = require('minecraft-data')(bot.version)
                const bedIds = Object.values(mcData.blocksByName)
                    .filter(b => b.name.endsWith('_bed'))
                    .map(b => b.id)

                const bedPos = bot.findBlock({ matching: bedIds, maxDistance: 32 })
                if (!bedPos) {
                    console.log('[SLEEP] No bed found within 32 blocks')
                    return
                }

                console.log(`[SLEEP] Night detected (${timeOfDay}), sleeping at ${bedPos.position}`)
                try {
                    await bot.sleep(bedPos)
                    console.log('[SLEEP] Sleeping...')
                } catch (e) {
                    // "You can only sleep at night" or already sleeping — ignore silently
                    if (!e.message.includes('night') && !e.message.includes('sleep')) {
                        console.log(`[SLEEP] Could not sleep: ${e.message}`)
                    }
                }

            } else if (!isNight && !isThunder && bot.isSleeping) {
                await bot.wake()
                console.log('[SLEEP] Morning — woke up')
            }
        } catch (e) {
            console.log(`[SLEEP] Tick error: ${e.message}`)
        }
    }

    bot.on('kicked', (reason) => {
        console.log(`[BOT] Kicked: ${reason}`)
        state.status = 'Reconnecting...'
        addLog(`Kicked: ${reason}`)
        stopMoving(true)
        if (sleepInterval) { clearInterval(sleepInterval); sleepInterval = null }
        setTimeout(createBot, 5000)
    })

    bot.on('error', (err) => {
        console.log(`[ERROR] ${err.message}`)
    })

    bot.on('end', () => {
        console.log('[BOT] Disconnected. Reconnecting in 5s...')
        state.status = 'Reconnecting...'
        addLog('Disconnected — reconnecting in 5s...')
        stopMoving(true)
        if (sleepInterval) { clearInterval(sleepInterval); sleepInterval = null }
        setTimeout(createBot, 5000)
    })

    return bot
}

console.log(`[BOT] Connecting to ${config.host}:${config.port} as ${config.username}...`)
createBot()
