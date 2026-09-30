import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import './App.css'

type Slot = { slot_start: string; slot_label: string; duration_minutes: number }
type Appointment = {
  id: string
  starts_at: string
  timezone: string
  duration_minutes: number
  customer_name: string
  customer_email: string
  customer_phone: string
  note: string | null
  status: 'pending' | 'confirmed' | 'cancelled'
}
type Notice = { kind: 'info' | 'success' | 'error'; text: string }

const getDateValue = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

const tomorrow = () => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return getDateValue(date)
}

const displayAppointmentDate = (appointment: Appointment) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: appointment.timezone,
  }).format(new Date(appointment.starts_at))

function App() {
  const [calendarBounds] = useState(() => {
    const today = new Date()
    const limit = new Date(today)
    limit.setDate(limit.getDate() + 90)
    return { minDate: getDateValue(today), maxDate: getDateValue(limit), year: today.getFullYear() }
  })
  const [session, setSession] = useState<Session | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [pageLoading, setPageLoading] = useState(Boolean(supabase))
  const [date, setDate] = useState(tomorrow)
  const [preferredTime, setPreferredTime] = useState('09:00')
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(Boolean(supabase))
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false)
  const [activeView, setActiveView] = useState<'book' | 'appointments'>('book')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true

    const refreshAccount = async (nextSession: Session | null) => {
      if (!active) return
      setSession(nextSession)
      if (!nextSession) {
        setIsOwner(false)
        setAppointments([])
        setPageLoading(false)
        return
      }

      const { data: ownerResult } = await client.rpc('is_owner')
      if (!active) return
      const owner = ownerResult === true
      setIsOwner(owner)
      let query = client.from('appointments').select(
        'id, starts_at, timezone, duration_minutes, customer_name, customer_email, customer_phone, note, status',
      ).order('starts_at', { ascending: true })
      if (!owner) query = query.eq('customer_id', nextSession.user.id)
      const { data } = await query
      if (!active) return
      setAppointments((data ?? []) as Appointment[])
      setPageLoading(false)
    }

    void client.auth.getSession().then(({ data }) => refreshAccount(data.session))
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => void refreshAccount(nextSession), 0)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.rpc('get_available_slots', { requested_date: date }).then(({ data, error }) => {
      if (!active) return
      setSlotsLoading(false)
      setSlots(error ? [] : (data ?? []) as Slot[])
    })
    return () => { active = false }
  }, [date])

  const requestSecureLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setWorking(true)
    setNotice(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { emailRedirectTo: window.location.origin },
    })
    setWorking(false)
    setNotice(error
      ? { kind: 'error', text: error.message }
      : { kind: 'success', text: 'Secure sign-in link sent. Open it from your email to continue.' })
  }

  const createAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !session?.user.email || !selectedSlot) return
    setWorking(true)
    setNotice(null)
    const { error } = await supabase.from('appointments').insert({
      customer_id: session.user.id,
      customer_email: session.user.email,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      starts_at: selectedSlot.slot_start,
      duration_minutes: selectedSlot.duration_minutes,
      note: note.trim() || null,
      status: 'pending',
    })
    if (error) {
      setNotice({ kind: 'error', text: error.code === '23505'
        ? 'That time was just taken. Choose another available time.'
        : 'The booking could not be saved. Please try again.' })
      setWorking(false)
      return
    }
    setNotice({ kind: 'success', text: 'Your appointment request is booked. Faisal can now see it in the owner dashboard.' })
    setCustomerName('')
    setCustomerPhone('')
    setNote('')
    setSelectedSlot(null)
    setWorking(false)
    const { data } = await supabase.from('appointments').select(
      'id, starts_at, timezone, duration_minutes, customer_name, customer_email, customer_phone, note, status',
    ).order('starts_at', { ascending: true })
    setAppointments((data ?? []) as Appointment[])
  }

  const updateAppointmentStatus = async (appointment: Appointment, status: Appointment['status']) => {
    if (!supabase) return
    setWorking(true)
    const { error } = await supabase.from('appointments').update({ status }).eq('id', appointment.id)
    setWorking(false)
    if (error) {
      setNotice({ kind: 'error', text: 'That appointment could not be updated.' })
      return
    }
    setAppointments((current) => current.map((item) => item.id === appointment.id ? { ...item, status } : item))
    setNotice({ kind: 'success', text: `Appointment marked ${status}.` })
  }

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setActiveView('book')
    setNotice({ kind: 'info', text: 'You have been signed out.' })
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#home" onClick={() => setActiveView('book')} aria-label="Faisal appointments home">
          <span className="brand-mark"><CalendarDays size={19} strokeWidth={2.1} /></span>
          <span className="brand-copy"><strong>Faisal</strong><small>PRIVATE APPOINTMENTS</small></span>
        </a>
        <div className="topbar-actions">
          {session && <button className="quiet-button" type="button" onClick={() => setActiveView(activeView === 'appointments' ? 'book' : 'appointments')}>
            {activeView === 'appointments' ? <><ArrowLeft size={16} /> Booking</> : <><CalendarDays size={16} /> {isOwner ? 'Owner dashboard' : 'My appointments'}</>}
          </button>}
          {session ? <button className="avatar-button" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button> :
            <button className="quiet-button owner-entry" type="button" onClick={() => { setOwnerDialogOpen(true); setNotice(null) }}><LockKeyhole size={15} /> Owner access</button>}
        </div>
      </header>

      {!supabase && <div className="setup-banner" role="status"><ShieldCheck size={18} /><span><strong>Bookings are not connected yet.</strong> Add your Supabase project settings to enable secure booking.</span></div>}
      {notice && <div className={`notice notice-${notice.kind}`} role="status">
        {notice.kind === 'success' ? <CheckCircle2 size={18} /> : notice.kind === 'error' ? <X size={18} /> : <ShieldCheck size={18} />}
        <span>{notice.text}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}

      <main id="home">
        {activeView === 'appointments' && session ? <section className="appointments-view">
          <div className="view-heading">
            <div className="eyebrow"><span className="eyebrow-dot" /> {isOwner ? 'FAISAL · OWNER VIEW' : 'YOUR PRIVATE SPACE'}</div>
            <h1>{isOwner ? 'Appointments' : 'Your appointments'}</h1>
            <p>{isOwner ? 'A private list of requests, visible only to you.' : 'Only you and Faisal can see the details of your appointments.'}</p>
          </div>
          {pageLoading ? <div className="empty-state">Loading your appointments...</div> : appointments.length === 0 ?
            <div className="empty-state"><CalendarDays size={28} /><strong>No appointments yet</strong><span>New bookings will appear here.</span></div> :
            <div className="appointment-list">{appointments.map((appointment) => <article className="appointment-row" key={appointment.id}>
              <div className="appointment-date-icon"><CalendarDays size={20} /></div>
              <div className="appointment-main">
                <strong>{displayAppointmentDate(appointment)}</strong>
                <span>{appointment.duration_minutes} minutes · {isOwner ? appointment.customer_name : 'With Faisal'}</span>
                {isOwner && <small>{appointment.customer_email} · {appointment.customer_phone}</small>}
                {appointment.note && isOwner && <p className="appointment-note">“{appointment.note}”</p>}
              </div>
              <span className={`status-pill status-${appointment.status}`}>{appointment.status}</span>
              {isOwner && appointment.status === 'pending' && <div className="row-actions">
                <button className="confirm-button" type="button" disabled={working} onClick={() => void updateAppointmentStatus(appointment, 'confirmed')}><Check size={15} /> Confirm</button>
                <button className="icon-action" type="button" title="Cancel appointment" aria-label="Cancel appointment" disabled={working} onClick={() => void updateAppointmentStatus(appointment, 'cancelled')}><X size={17} /></button>
              </div>}
            </article>)}</div>}
        </section> : <div className="booking-layout">
          <section className="intro-panel">
            <div className="eyebrow"><span className="eyebrow-dot" /> ONE-TO-ONE · BY APPOINTMENT</div>
            <h1>Make room for a <em>good conversation.</em></h1>
            <p className="intro-copy">Choose a time that works for you. Your appointment details stay private between you and Faisal.</p>
            <div className="portrait-scene" aria-label="Faisal appointment profile">
              <div className="scene-grid" /><span className="scene-sun" />
              <div className="portrait-card"><div className="portrait-initial">F</div>
                <div><span className="portrait-label">YOUR HOST</span><strong>Faisal</strong><small>Available by appointment</small></div>
                <Sparkles className="portrait-sparkle" size={19} />
              </div>
              <div className="scene-caption"><span>01</span><span>A little time, just for you</span></div>
            </div>
            <div className="trust-note"><ShieldCheck size={17} /><span>Private by design. Your booking is never shown to other visitors.</span></div>
          </section>

          <section className="booking-card" aria-labelledby="booking-title">
            <div className="card-heading"><div><div className="card-kicker">FAISAL · PRIVATE SESSION</div><h2 id="booking-title">Book an appointment</h2></div><span className="duration-badge"><Clock3 size={14} /> 30 min</span></div>
            <div className="slot-picker">
              <div className="field-block"><div className="field-label-row"><label htmlFor="appointment-date">Choose a date</label><span>Next 90 days</span></div>
                <div className="date-field"><CalendarDays size={18} /><input id="appointment-date" type="date" value={date} min={calendarBounds.minDate} max={calendarBounds.maxDate} onChange={(event) => { setSlotsLoading(true); setSelectedSlot(null); setDate(event.target.value) }} required /></div>
              </div>
              <div className="field-block"><div className="field-label-row"><span className="form-label">{supabase ? 'Available times' : 'Preferred time'}</span><span>{supabase ? 'Faisal’s time zone' : 'Setup preview'}</span></div>
                {!supabase ? <>
                  <div className="date-field"><Clock3 size={17} /><input aria-label="Preferred appointment time" type="time" value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)} /></div>
                  <div className="slot-message">Connect the booking database to verify open times. This preference does not reserve a slot.</div>
                </> : slotsLoading ? <div className="slot-message">Checking availability...</div> : slots.length === 0 ? <div className="slot-message">No open times on this date. Try another day.</div> :
                  <div className="time-grid">{slots.map((slot) => <button className={`time-slot${selectedSlot?.slot_start === slot.slot_start ? ' selected' : ''}`} type="button" key={slot.slot_start} onClick={() => setSelectedSlot(slot)} aria-pressed={selectedSlot?.slot_start === slot.slot_start}>{slot.slot_label}</button>)}</div>}
              </div>
            </div>
            {!session ? <div className="verify-panel">
              <div className="verify-icon"><ShieldCheck size={23} /></div>
              <h3>Finish with a secure sign-in</h3>
              <p>Choose an available time, then verify your email to complete the booking. Only you and Faisal can see its details.</p>
              <form className="email-form" onSubmit={(event) => void requestSecureLink(event)}>
                <label htmlFor="booking-email">Your email address</label>
                <input id="booking-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                <button className="primary-button full-button" type="submit" disabled={!supabase || !selectedSlot || working}>{working ? 'Sending link...' : 'Email me a secure link'} <ArrowRight size={17} /></button>
              </form>
              <div className="secure-caption"><LockKeyhole size={13} /> No password needed. Your email is private.</div>
            </div> : <>
              <div className="signed-in-line"><span className="signed-in-check"><Check size={12} /></span><span>Signed in as <strong>{session.user.email}</strong></span></div>
              <form className="booking-form" onSubmit={(event) => void createAppointment(event)}>
                <div className="form-divider" />
                <div className="field-block"><label htmlFor="customer-name">Your name</label><input className="text-input" id="customer-name" autoComplete="name" required maxLength={100} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Name" /></div>
                <div className="field-block"><label htmlFor="customer-phone">Phone number</label><input className="text-input" id="customer-phone" type="tel" autoComplete="tel" required maxLength={40} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="For appointment updates" /></div>
                <div className="field-block"><label htmlFor="appointment-note">Anything Faisal should know? <span className="optional">Optional</span></label><textarea className="text-input note-input" id="appointment-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="A short note for Faisal" rows={3} /></div>
                <button className="primary-button full-button" type="submit" disabled={!selectedSlot || slotsLoading || working}>{working ? 'Saving appointment...' : 'Request this time'} <ArrowRight size={17} /></button>
                <div className="private-caption"><LockKeyhole size={13} /><span>Your details are visible only to you and Faisal.</span></div>
              </form>
            </>}
          </section>
        </div>}
      </main>

      <footer className="site-footer"><span>© {calendarBounds.year} Faisal Appointments</span><span><ShieldCheck size={14} /> Private and secure</span></footer>

      {ownerDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOwnerDialogOpen(false) }}>
        <section className="owner-dialog" role="dialog" aria-modal="true" aria-labelledby="owner-dialog-title">
          <button className="dialog-close" type="button" aria-label="Close" onClick={() => setOwnerDialogOpen(false)}><X size={19} /></button>
          <div className="verify-icon"><LockKeyhole size={22} /></div><div className="card-kicker">PRIVATE OWNER AREA</div>
          <h2 id="owner-dialog-title">Faisal’s dashboard</h2>
          <p>Sign in with the owner email configured for this booking site. Only that account can see all appointments.</p>
          <form className="email-form" onSubmit={(event) => { void requestSecureLink(event); setOwnerDialogOpen(false) }}>
            <label htmlFor="owner-email">Owner email address</label><input id="owner-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="faisal@example.com" />
            <button className="primary-button full-button" type="submit" disabled={!supabase || working}>{working ? 'Sending link...' : 'Send owner sign-in link'} <ArrowRight size={17} /></button>
          </form>
          <div className="secure-caption"><LockKeyhole size={13} /> Access is checked by the database.</div>
        </section>
      </div>}
    </div>
  )
}

export default App