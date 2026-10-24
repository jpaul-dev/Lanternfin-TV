document.getElementById('pair').addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.currentTarget.querySelector('button'), status = document.getElementById('status')
  button.disabled = true; status.textContent = 'Joining your home…'
  try {
    const response = await fetch('/_home/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lanternfin-Home': '1' }, body: JSON.stringify({ code: document.getElementById('code').value, name: /Android|iPhone|iPad/.test(navigator.userAgent) ? 'Phone / tablet browser' : 'Web browser' }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Could not join this home.')
    location.replace('/')
  } catch (error) { status.textContent = error.message; button.disabled = false }
})
