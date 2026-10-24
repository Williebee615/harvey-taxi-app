// Nashville destination pages (owner decision 2026-10-23): one
// server-rendered page per destination plus a hub, so search engines see
// real HTML at a real URL. Content is transportation logistics only.
//
// Every venue fact comes from the venue's (or Metro Nashville's) own
// website, found by search on 2026-10-23; the page cites each source and
// tells riders to confirm on the day. Where official sources disagree or
// say nothing, the page says so instead of guessing. No airport (BNA)
// page and no airport claims (standing owner rule). No fixed fares: the
// page links to a live estimate in the booking screen.
//
// Pure: no I/O. Travel times are passed in by the server (Mapbox, cached).

const CHECKED_ON = "2026-10-23";
const SITE = "https://harveytaxiservice.com";

// Starting points for the travel-time table. Labels are neighborhoods;
// the address is only what the route is measured from.
const ORIGINS = Object.freeze([
  { id: "downtown", label: "Downtown (Nashville Public Library)", address: "615 Church Street, Nashville, TN 37219" },
  { id: "midtown", label: "Midtown (West End Avenue)", address: "2100 West End Avenue, Nashville, TN 37203" },
  { id: "east", label: "East Nashville (Five Points)", address: "1000 Woodland Street, Nashville, TN 37206" }
]);

const DESTINATIONS = Object.freeze([
  {
    slug: "broadway-downtown",
    name: "Lower Broadway & Downtown",
    category: "District",
    cluster: "downtown",
    events: true,
    address: "Lower Broadway, Nashville, TN 37203",
    summary: "Rides to and from Lower Broadway's honky-tonks and downtown Nashville without hunting for parking.",
    dropoff: [
      "Lower Broadway between 1st and 5th Avenues is crowded with pedestrians, especially late at night. Metro Nashville cites hazardous conditions near Broadway entertainment venues as the reason for its rideshare-zone work.",
      "Metro's Traffic & Parking Commission has reviewed a Downtown Rideshare Program with 23 pickup and drop-off zones in existing loading zones and metered spaces (proposed hours Thursday to Sunday, 5 PM to 4 AM, three-minute limit). We could not confirm whether it has been approved; follow posted signs.",
      "Setting your pickup pin on a side street a block off Broadway usually makes it easier for your driver to reach you."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Downtown parking is paid garages, surface lots and meters. A ride avoids garage fees and the walk back late at night."
    ],
    sources: [
      { label: "Metro Nashville: Rideshare Zone Pilot Program", url: "https://www.nashville.gov/departments/transportation/plans-and-programs/transportation-demand/rideshare-pilot" },
      { label: "Metro Traffic & Parking Commission staff analysis (April 2026)", url: "https://www.nashville.gov/sites/default/files/2026-04/TPC_StaffAnalysis_APR2026.pdf" }
    ],
    related: ["ryman-auditorium", "bridgestone-arena", "nissan-stadium"]
  },
  {
    slug: "ryman-auditorium",
    name: "Ryman Auditorium",
    category: "Venue",
    cluster: "downtown",
    events: true,
    address: "116 Rep. John Lewis Way North, Nashville, TN 37219",
    summary: "Rides to shows and tours at the Ryman Auditorium, half a block off Broadway.",
    dropoff: [
      "The Ryman is between Fourth and Fifth Avenues, half a block north of Broadway. The entrance is on the Fourth Avenue side of the building, so ask to be dropped on that side.",
      "The Ryman does not publish a specific rideshare drop-off or pickup spot. After the show, set your pickup pin a short walk away from the Broadway crowds."
    ],
    accessibility: [
      "The Ryman handles accessible seating and services through a contact form on its Accessibility page. Some parts of the tour may not be accessible to guests with mobility difficulties, according to the venue."
    ],
    parking: [
      "The Ryman has no public parking lot. It points drivers to the Fifth + Broadway garage across the street and to other paid lots and meters nearby."
    ],
    sources: [
      { label: "Ryman: Directions, Parking & Transportation", url: "https://www.ryman.com/plan-your-visit/know-before-you-go/directions-parking-transportation" },
      { label: "Ryman: Accessibility", url: "https://www.ryman.com/accessibility" }
    ],
    related: ["broadway-downtown", "bridgestone-arena"]
  },
  {
    slug: "bridgestone-arena",
    name: "Bridgestone Arena",
    category: "Venue",
    cluster: "downtown",
    events: true,
    address: "501 Broadway, Nashville, TN 37203",
    summary: "Rides to Predators games and concerts at Bridgestone Arena.",
    dropoff: [
      "The arena lists its rideshare and guest drop-off in the eastbound curb lane of Broadway between 6th and 5th Avenues.",
      "Event traffic and street closures change on busy nights. Follow posted signs and staff directions."
    ],
    accessibility: [
      "Accessible entrances listed by the arena: the main entrance at 5th and Broadway, the SoBro entrance at 5th and Demonbreun, and the entry points from the 6th Avenue Garage.",
      "The southwest elevator is next to the 6th Avenue garage entrance. Accessible seating is on all levels."
    ],
    parking: [
      "Official garages include Fifth + Broadway (across from the arena) and 222 2nd Ave; accessible parking stalls are in the 6th Avenue Garage for placard or plate holders. Event parking is paid, and a ride skips the garage exit line."
    ],
    sources: [
      { label: "Bridgestone Arena: Directions & Parking", url: "https://www.bridgestonearena.com/plan-your-visit/directions-parking" },
      { label: "Bridgestone Arena: Accessibility", url: "https://www.bridgestonearena.com/accessibility" },
      { label: "Bridgestone Arena: Arena Policies (guest drop-off point)", url: "https://www.bridgestonearena.com/arena-info/arena-policies" }
    ],
    related: ["broadway-downtown", "ryman-auditorium", "nissan-stadium"]
  },
  {
    slug: "grand-ole-opry",
    name: "Grand Ole Opry",
    category: "Venue",
    cluster: "opryland",
    events: true,
    address: "600 Opry Mills Drive, Nashville, TN 37214",
    summary: "Rides to evening shows and tours at the Grand Ole Opry House.",
    dropoff: [
      "For shows, the Opry asks guests to use the doors along the front of the building.",
      "The Opry does not publish a specific rideshare zone. The Opry House sits in the Opry complex with Opry Mills, so check the address in the app before you confirm."
    ],
    accessibility: [
      "The Opry lends wheelchairs free, first come, first served, with a valid photo ID. Wheelchair-accessible seating is on the upper and lower levels, and FM assistive listening devices are at the Tour Desk in the lobby."
    ],
    parking: [
      "Paid parking is run by Metropolis, booked in advance, and available for evening shows from 5 PM, according to the Opry. A ride avoids the post-show exit from the lot."
    ],
    sources: [
      { label: "Opry: Directions, Parking & Transportation", url: "https://www.opry.com/plan-your-visit/opry-house/directions-parking-transportation" },
      { label: "Opry: Accessibility", url: "https://www.opry.com/accessibility" },
      { label: "Opry: Parking", url: "https://www.opry.com/plan-your-visit/parking" }
    ],
    related: ["opry-mills", "gaylord-opryland"]
  },
  {
    slug: "opry-mills",
    name: "Opry Mills",
    category: "Shopping",
    cluster: "opryland",
    events: false,
    address: "433 Opry Mills Drive, Nashville, TN 37214",
    summary: "Rides to and from Opry Mills shopping, dining and the cinema.",
    dropoff: [
      "Opry Mills lists a ride-share pick-up and drop-off zone on its website but does not give its exact location there. Use the mall's map or signs when you arrive.",
      "The mall has numbered entries (for example Entry 2 by the valet stand). Naming your entry in a note helps your driver find you."
    ],
    accessibility: [
      "If you need help getting to the car, add a note for your driver when you book."
    ],
    parking: [
      "Paid Up Front Plus parking is at the mall entrances, with prices that vary by day and time; valet is at Entry 2."
    ],
    sources: [
      { label: "Opry Mills (Simon): About and directions", url: "https://www.simon.com/mall/opry-mills/about" },
      { label: "Opry Mills (Simon): Valet parking", url: "https://www.simon.com/mall/opry-mills/stores/valet-parking" }
    ],
    related: ["grand-ole-opry", "gaylord-opryland"]
  },
  {
    slug: "gaylord-opryland",
    name: "Gaylord Opryland Resort",
    category: "Resort",
    cluster: "opryland",
    events: false,
    address: "2800 Opryland Drive, Nashville, TN 37214",
    summary: "Rides to Gaylord Opryland Resort and Convention Center for stays, conventions and holiday events.",
    dropoff: [
      "The resort's meeting planner map shows a taxi and rideshare pickup area near the Magnolia section, separate from the shuttle pickup at the Cascades Portico. Confirm with the front desk on arrival.",
      "The resort is large; tell your driver which entrance or ballroom you are heading to."
    ],
    accessibility: [
      "If you need extra time or help with luggage, add a note for your driver when you book."
    ],
    parking: [
      "The resort charges daily self-parking and valet fees; Marriott's listings show different rates, so check the current rate before you drive."
    ],
    sources: [
      { label: "Marriott: Gaylord Opryland Resort details", url: "https://www.marriott.com/en-us/hotels/bnago-gaylord-opryland-resort-and-convention-center/details/" },
      { label: "Gaylord Opryland meeting planning guide (property map)", url: "https://www.marriott.com/content/dam/marriott-digital/ge/us-canada/hws/b/bnago/en_us/document/assets/ge-bnago-gaylordmeetingplanner-37784.pdf" }
    ],
    related: ["grand-ole-opry", "opry-mills"]
  },
  {
    slug: "nissan-stadium",
    name: "Nissan Stadium",
    category: "Venue",
    cluster: "downtown",
    events: true,
    address: "One Titans Way, Nashville, TN 37213",
    summary: "Rides to Titans games, Nashville SC matches and stadium concerts.",
    dropoff: [
      "The stadium's transportation guide lists two rideshare zones: Crutcher Street on the south end and Gay Street on the north end, across the Woodland Street bridge.",
      "Older event pages name different spots, and zones can change by event. Check the event page and follow posted signs on the day."
    ],
    accessibility: [
      "The ADA drop-off and pick-up is in Lot T and needs a stadium-issued ADA Lane pass, which does not include parking. Fan Services staff can help with wheelchair pick-up and drop-off on event days."
    ],
    parking: [
      "Stadium lots are paid and fill up on game days. A ride drops you at the rideshare zone instead."
    ],
    sources: [
      { label: "Nissan Stadium: Parking & Transportation Guide", url: "https://nissanstadium.com/transportation/" },
      { label: "Nissan Stadium: Accessibility & ADA Services", url: "https://nissanstadium.com/accessibility/" },
      { label: "Nissan Stadium: Contact (address)", url: "https://nissanstadium.com/contact/" }
    ],
    related: ["broadway-downtown", "bridgestone-arena"]
  },
  {
    slug: "nashville-zoo",
    name: "Nashville Zoo at Grassmere",
    category: "Family",
    cluster: "south",
    events: false,
    address: "3777 Nolensville Pike, Nashville, TN 37211",
    summary: "Family rides to the Nashville Zoo at Grassmere off Nolensville Pike.",
    dropoff: [
      "The zoo does not publish a rideshare zone. Ask to be dropped at the main entrance from the parking area."
    ],
    accessibility: [
      "Manual wheelchairs and electric scooters can be rented at the zoo entrance, first come, first served; personal wheelchairs are welcome. Leashed, trained service dogs are welcome; tell staff at the entrance.",
      "On busy days the zoo opens an unpaved overflow lot and suggests the main lot for strollers and wheelchairs that aren't all-terrain."
    ],
    parking: [
      "The zoo charges a per-vehicle parking fee (members park free). Its pages show different amounts, so check before you go."
    ],
    sources: [
      { label: "Nashville Zoo: Accessibility", url: "https://www.nashvillezoo.org/accessibility" },
      { label: "Nashville Zoo: Hours & Directions", url: "https://www.nashvillezoo.org/hours-directions" },
      { label: "Nashville Zoo: Visit", url: "https://www.nashvillezoo.org/visit" }
    ],
    related: ["broadway-downtown"]
  },
  {
    slug: "vanderbilt-medical-center",
    name: "Vanderbilt University Medical Center",
    category: "Medical",
    cluster: "midtown",
    events: false,
    address: "1211 Medical Center Drive, Nashville, TN 37232",
    summary: "Rides to appointments and visits at Vanderbilt University Medical Center. Not for emergencies: call 911.",
    dropoff: [
      "VUMC's valet entrance is on 21st Avenue, next to the Medical Arts building (valet hours 5 AM to 7 PM, per VUMC).",
      "Labor and delivery patients more than 20 weeks pregnant have their own entrance off 21st Avenue, separate from the main entrance.",
      "Drop-off points have changed during construction. Check your appointment letter or VUMC's parking page for your building's entrance."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "VUMC lists free valet for patients and visitors on the main campus, with longer waits during construction. A ride avoids the garage and the valet line."
    ],
    sources: [
      { label: "Vanderbilt Health: Parking and Transportation", url: "https://www.vanderbilthealth.com/information/parking-and-transportation" },
      { label: "VUMC: Valet Service", url: "https://www.vumc.org/med-center-parking/valet-service" },
      { label: "Vanderbilt Health: Labor and Delivery Entrance", url: "https://www.vanderbilthealth.com/locations/vanderbilt-university-hospital-labor-and-delivery-entrance" }
    ],
    related: ["vanderbilt-university", "belmont-university"]
  },
  {
    slug: "vanderbilt-university",
    name: "Vanderbilt University",
    category: "University",
    cluster: "midtown",
    events: false,
    address: "2305 West End Avenue, Nashville, TN 37203",
    summary: "Rides to Vanderbilt University for campus visits, classes and events.",
    dropoff: [
      "Undergraduate Admissions is at 2305 West End Avenue. For other buildings, enter the building's own address so your driver goes to the right side of campus."
    ],
    accessibility: [
      "If you need help from the car, add a note for your driver when you book."
    ],
    parking: [
      "Vanderbilt lists visitor parking at $4 per hour. Admissions visitors are pointed to the paid 2525 West End Garage, about a 10-minute walk from admissions events, with a 7-foot height limit."
    ],
    sources: [
      { label: "Vanderbilt: Visitor parking", url: "https://www.vanderbilt.edu/transportation-parking/parking/visitors/" },
      { label: "Vanderbilt Admissions: Visit campus", url: "https://admissions.vanderbilt.edu/visit/" },
      { label: "Vanderbilt Admissions: Parking for programs", url: "https://admissions.vanderbilt.edu/visit/parking.php" }
    ],
    related: ["vanderbilt-medical-center", "belmont-university"]
  },
  {
    slug: "belmont-university",
    name: "Belmont University",
    category: "University",
    cluster: "midtown",
    events: false,
    address: "1900 Belmont Boulevard, Nashville, TN 37212",
    summary: "Rides to Belmont University for campus visits, classes and Curb Event Center events.",
    dropoff: [
      "Admissions visitors use the Johnson Center entrance at 1909 15th Avenue South. For other buildings, enter the building's name or address, or check Belmont's campus map."
    ],
    accessibility: [
      "Belmont publishes an accessibility campus map. If you need help from the car, add a note for your driver when you book."
    ],
    parking: [
      "Belmont offers free visitor parking registration online for up to two days, and admissions visitors park in the Johnson Center garage."
    ],
    sources: [
      { label: "Belmont: Where to Park", url: "https://www.belmont.edu/about/visit/parking.html" },
      { label: "Belmont: Accessibility map (PDF)", url: "https://www.belmont.edu/about/visit/_files/campus-maps/accessibility-map.pdf" }
    ],
    related: ["vanderbilt-university", "vanderbilt-medical-center"]
  }  ,
  // ---- Batch 2 (owner decision 2026-10-23): 4 venues + 4 hospitals ----
  {
    slug: "geodis-park",
    name: "GEODIS Park",
    category: "Stadium",
    cluster: "south",
    events: true,
    address: "501 Benton Avenue, Nashville, TN 37203",
    summary: "Rides to Nashville SC matches, concerts and events at GEODIS Park without buying a lot or sitting in the post-match exit line.",
    dropoff: [
      "Nashville SC's 2026 guidance moves the rideshare drop-off and pickup to Craighead Street. After a match, guest pickup is allowed only in that zone (Zones 1 to 4).",
      "Some older GEODIS Park pages still name Wedgewood Avenue near Lot 11, or Fair Park on Bransford Avenue. Those appear out of date; follow the event's own page and posted signs."
    ],
    accessibility: [
      "After matches, an ADA shuttle runs to the rideshare zone. GEODIS Park lists its pickup at the north end of Lot 9, outside Gate G.",
      "Limited ADA parking is by request through Membership Services (615-750-8800). An older FAQ lists an ADA drop-off and turnaround on Benton Avenue; confirm it before the event.",
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "GEODIS Park says parking prices vary by event. Lots usually go on sale about 10 days ahead, with limited spaces on the day. A ride avoids buying a lot and queuing to leave it."
    ],
    sources: [
      { label: "GEODIS Park: Transportation", url: "https://geodispark.com/transportation/" },
      { label: "GEODIS Park: Parking FAQ", url: "https://geodispark.com/parking/faq/" },
      { label: "Nashville SC: New for '26, more parking and updates to rideshare", url: "https://www.nashvillesc.com/news/new-for-26-geodis-park-parking-rideshare" }
    ],
    related: ["nashville-zoo", "broadway-downtown"]
  },
  {
    slug: "music-city-center",
    name: "Music City Center",
    category: "Convention center",
    cluster: "downtown",
    events: true,
    address: "201 Rep. John Lewis Way South, Nashville, TN 37203",
    summary: "Rides to conventions, trade shows and events at Music City Center, downtown Nashville's convention center.",
    dropoff: [
      "The main entrance is at 201 Rep. John Lewis Way South. Music City Center's website does not name a rideshare zone, so set your pin at the entrance your event uses and follow event signs.",
      "Pickup is easier on the street than inside the venue garage, whose main entrance is at 7th Avenue and Demonbreun Street."
    ],
    accessibility: [
      "The garage has accessible parking next to the elevators on each level. The venue lends complimentary wheelchairs for tours, and its wayfinding app gives step-by-step directions inside the building.",
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "The Music City Center garage (701 Demonbreun Street, about 1,800 spaces) takes cards at the exit. On busy convention days a ride avoids the queue in and out."
    ],
    sources: [
      { label: "Music City Center: Maps & Parking", url: "https://www.nashvillemusiccitycenter.com/parking" },
      { label: "Music City Center: Tour the Music City Center", url: "https://www.nashvillemusiccitycenter.com/tour-music-city-center-14" },
      { label: "Music City Center: Wayfinding App", url: "https://nashvillemusiccitycenter.com/exhibitors/wayfinding-app" }
    ],
    related: ["country-music-hall-of-fame", "broadway-downtown", "bridgestone-arena"]
  },
  {
    slug: "country-music-hall-of-fame",
    name: "Country Music Hall of Fame and Museum",
    category: "Museum",
    cluster: "downtown",
    events: true,
    address: "222 Rep. John Lewis Way South, Nashville, TN 37203",
    summary: "Rides to the Country Music Hall of Fame and Museum and shows at its CMA Theater, without paying for a downtown garage.",
    dropoff: [
      "The museum's website does not name a rideshare spot. School groups are dropped at the front of the building on Demonbreun Street, which also works for a ride drop-off.",
      "The CMA Theater and Hatch Show Print entrance is at 224 Rep. John Lewis Way South, next door to the main museum entrance."
    ],
    accessibility: [
      "Every entrance has a ramp. A limited number of free manual wheelchairs are lent first come, first served, with photo ID, for use on site. Motorized wheelchairs and scooters can't go on the Studio B tour shuttle.",
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "The Walk of Fame Park and SoBro Tower garages offer museum visitors $15 for up to 3 hours or $25 for up to 6 hours, 9 AM to 6 PM, with museum validation. A ride avoids the garage altogether."
    ],
    sources: [
      { label: "Country Music Hall of Fame: Know Before You Go", url: "https://www.countrymusichalloffame.org/plan-your-visit/know-before-you-go" },
      { label: "Country Music Hall of Fame: Accessibility", url: "https://www.countrymusichalloffame.org/accessibility" },
      { label: "Country Music Hall of Fame: Plan Your Visit to the CMA Theater", url: "https://countrymusichalloffame.org/experiences/cma-theater/plan-your-visit" }
    ],
    related: ["music-city-center", "broadway-downtown", "ryman-auditorium"]
  },
  {
    slug: "parthenon-centennial-park",
    name: "The Parthenon & Centennial Park",
    category: "Museum & park",
    cluster: "midtown",
    events: false,
    address: "2500 West End Avenue, Nashville, TN 37203",
    summary: "Rides to the Parthenon art museum and Centennial Park on West End.",
    dropoff: [
      "The Parthenon lists a drop-off lane near its entrance, which is on the east side of the building at sidewalk level.",
      "Metro Parks has closed parts of the north side of Centennial Park for construction, including part of 27th Avenue North, while keeping the Parthenon and its lot open. Check Metro's construction page before you go."
    ],
    accessibility: [
      "Paved accessible sidewalks lead to the entrance; ramps and an elevator reach every exhibit on both levels. Doors don't have automatic openers. Strollers and wheelchairs are welcome. ADA questions: Metro Parks, 615-862-8400.",
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "The Parthenon lot is free, with 96 standard and 4 accessible spaces; cars parked outside marked spaces can be towed. When the lot is full or there's a park event, a ride avoids circling."
    ],
    sources: [
      { label: "Nashville Parthenon: Accessibility", url: "https://www.nashvilleparthenon.com/accessibility" },
      { label: "Nashville Parthenon: FAQs", url: "https://www.nashvilleparthenon.com/faqs" },
      { label: "Metro Parks: Centennial Park construction and parking closures", url: "https://www.nashville.gov/departments/parks/centennial-park-construction" }
    ],
    related: ["vanderbilt-university", "belmont-university"]
  },
  {
    slug: "saint-thomas-midtown",
    name: "Ascension Saint Thomas Hospital Midtown",
    category: "Medical",
    cluster: "midtown",
    events: false,
    address: "2000 Church Street, Nashville, TN 37203",
    summary: "Rides to appointments and visits at Ascension Saint Thomas Hospital Midtown. Not for emergencies: call 911.",
    dropoff: [
      "Patient drop-off is directly outside the main entrance; the patient pickup area is the small side lot next to it.",
      "The Emergency Department has its own drop-off outside its entrance off 20th Avenue North."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "Ascension lists self-parking in the 20th Avenue Garage (1904 State Street) and the Heritage Garage (2107 State Street, with a bridge into the hospital on level 1); the Mid-State Garage is reserved for some patient groups. An older patient handbook lists free weekday valet at the main entrance; confirm current hours."
    ],
    sources: [
      { label: "Ascension Saint Thomas: Wayfinding (Midtown)", url: "https://healthcare.ascension.org/wayfinding?id=3783cdc657604a47885a948d65ca2db3" },
      { label: "Ascension Saint Thomas Hospital Midtown: Visitor Information", url: "https://healthcare.ascension.org/Locations/Tennessee/TNNAS/Nashville-Ascension-Saint-Thomas-Hospital-Midtown/Visitor-Information" },
      { label: "Saint Thomas Midtown patient handbook (PDF)", url: "https://healthcare.ascension.org/-/media/project/ascension/healthcare/legacy/markets/tennessee/st-thomas/documents/midtown-patient-handbook.pdf" }
    ],
    related: ["vanderbilt-medical-center", "monroe-carell-childrens-hospital"]
  },
  {
    slug: "saint-thomas-west",
    name: "Ascension Saint Thomas Hospital West",
    category: "Medical",
    cluster: "midtown",
    events: false,
    address: "4220 Harding Pike, Nashville, TN 37205",
    summary: "Rides to appointments and visits at Ascension Saint Thomas Hospital West on Harding Pike. Not for emergencies: call 911.",
    dropoff: [
      "Ascension's public pages don't describe the West hospital's entrances or drop-off points. Use the building on your appointment letter, or call the hospital at (615) 222-2111, and add the entrance to your driver note when you book.",
      "Medical Plaza West and Medical Plaza East clinics are on the same campus; check which building your appointment is in."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "We could not find official parking or valet details for Saint Thomas West. A ride avoids looking for a space on a large campus."
    ],
    sources: [
      { label: "Ascension: Hospitals in Nashville (Saint Thomas West listing)", url: "https://healthcare.ascension.org/find-care/location/hospitals/nashville--tennessee" },
      { label: "Ascension Saint Thomas: Medical Plaza West", url: "https://healthcare.ascension.org/locations/tennessee/tnnas/nashville-ascension-saint-thomas-hospital-west/departments/medical-plaza-west" }
    ],
    related: ["saint-thomas-midtown", "parthenon-centennial-park"]
  },
  {
    slug: "monroe-carell-childrens-hospital",
    name: "Monroe Carell Jr. Children's Hospital at Vanderbilt",
    category: "Medical",
    cluster: "midtown",
    events: false,
    address: "2200 Children's Way, Nashville, TN 37232",
    summary: "Rides to appointments and visits at Monroe Carell Jr. Children's Hospital at Vanderbilt. Not for emergencies: call 911.",
    dropoff: [
      "Vanderbilt recommends the South Garage on Children's Way, between 23rd and 24th Avenues. A covered walkway leads from the garage to the hospital's second-floor entrance.",
      "A Vanderbilt surgery page says valet is also available at the front entrance on the first floor. Check your appointment instructions for the right entrance."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "Vanderbilt lists free valet Monday to Friday, 5 AM to 8 PM, inside the South Garage entrance (turn right as you enter)."
    ],
    sources: [
      { label: "Monroe Carell Jr. Children's Hospital at Vanderbilt: Location", url: "https://www.childrenshospitalvanderbilt.org/locations/monroe-carell-jr-childrens-hospital-vanderbilt" },
      { label: "Monroe Carell: Family and Visitor Services", url: "https://www.childrenshospitalvanderbilt.org/information/family-and-visitor-services-monroe-carell" },
      { label: "Monroe Carell: Surgery", url: "https://www.childrenshospitalvanderbilt.org/patient-resource/surgery-monroe-carell-jr-childrens-hospital-vanderbilt" }
    ],
    related: ["vanderbilt-medical-center", "vanderbilt-university"]
  },
  {
    slug: "nashville-va-medical-center",
    name: "Nashville VA Medical Center",
    category: "Medical",
    cluster: "midtown",
    events: false,
    address: "1310 24th Avenue South, Nashville, TN 37212",
    summary: "Rides to appointments and visits at the Nashville VA Medical Center (VA Tennessee Valley). Not for emergencies: call 911.",
    dropoff: [
      "VA Tennessee Valley says the parking garage is entered from the corner of 24th Avenue South and Pierce Avenue, not from Highland Avenue, and the service street in front of the hospital is one-way. The emergency entrance is unchanged.",
      "Check the VA's location page for current parking and transportation details before your visit."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "The VA's notice covers garage access only; we could not find current visitor parking rules. A ride avoids the garage queue."
    ],
    sources: [
      { label: "VA: Nashville VA Medical Center", url: "https://www.va.gov/tennessee-valley-health-care/locations/nashville-va-medical-center/" },
      { label: "VA Tennessee Valley: Parking notice", url: "https://tennesseevalley.va.gov/features/Parking_Notice.asp" }
    ],
    related: ["vanderbilt-medical-center", "vanderbilt-university"]
  },
  {
    slug: "the-gulch",
    name: "The Gulch",
    category: "District",
    cluster: "downtown",
    events: false,
    checked: "2026-10-24",
    address: "11th Avenue South, Nashville, TN 37203",
    summary: "Rides to and from the Gulch's restaurants, bars and murals, a mile from Lower Broadway.",
    dropoff: [
      "Visit Music City describes the Gulch as centered on 11th and 12th Avenues South, between Broadway and Division Street, about a mile (roughly a 20-minute walk) from Lower Broadway.",
      "Some Gulch buildings route rideshare pickups into their own garages: Metro's Downtown Code design review required one development to run rideshare inside the garage off 9th Avenue South instead of on the street. Follow the building's signs.",
      "Metro's Traffic & Parking Commission has reviewed a downtown rideshare program with 23 zones (proposed Thursday to Sunday, 5 PM to 4 AM, three minutes each). We could not confirm whether any of those zones are in the Gulch, so follow posted signs."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Visit Music City says paid street parking, surface lots and garages are spread through the neighborhood, with rates and time limits that vary by block. Nashville Downtown lists Gulch garages including ICON (600 12th Avenue South) and Gulch Crossing (1033 Demonbreun Street)."
    ],
    sources: [
      { label: "Visit Music City: The Gulch", url: "https://www.visitmusiccity.com/nashville-neighborhoods/the-gulch" },
      { label: "Nashville Downtown: ICON Garage", url: "https://nashvilledowntown.com/parking/icon-garage" },
      { label: "Metro Traffic & Parking Commission staff analysis (April 2026)", url: "https://www.nashville.gov/sites/default/files/2026-04/TPC_StaffAnalysis_APR2026.pdf" }
    ],
    related: ["broadway-downtown", "midtown-music-row"]
  },
  {
    slug: "twelve-south",
    name: "12 South",
    category: "District",
    cluster: "south",
    events: false,
    checked: "2026-10-24",
    address: "12th Avenue South, Nashville, TN 37204",
    summary: "Rides to 12 South's shops, restaurants and murals without circling for a two-hour space.",
    dropoff: [
      "Visit Music City describes 12 South as a half-mile stretch of 12th Avenue South, from Wedgewood Avenue south to Sevier Park, so almost anywhere on that strip is a short walk from the rest.",
      "The strip has no posted rideshare zone. Giving your driver the business address, or a quieter cross street, is usually easier than the middle of 12th Avenue."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Parking here is mostly on-street and time-limited. Metro's Traffic & Parking Commission listed two-hour limits on both sides of 12th Avenue South between Ashwood and Kirkwood Avenues (6 AM to 8 PM) on its May 2026 agenda; we could not confirm it has taken effect, and NDOT held a neighborhood meeting about parking on this corridor in July 2025. Read the signs on the block, and note that nearby side streets include residential parking."
    ],
    sources: [
      { label: "Visit Music City: 12South", url: "https://www.visitmusiccity.com/nashville-neighborhoods/12south" },
      { label: "Metro Traffic & Parking Commission agenda (May 2026)", url: "https://www.nashville.gov/sites/default/files/2026-05/TPC_Agenda_MAY2026.pdf" },
      { label: "Metro NDOT: 12th Ave South neighborhood parking meeting", url: "https://www.nashville.gov/departments/transportation/events/12th-ave-south-neighborhood-parking-meeting" }
    ],
    related: ["belmont-university", "lipscomb-university"]
  },
  {
    slug: "east-nashville-five-points",
    name: "East Nashville (Five Points)",
    category: "District",
    cluster: "east",
    events: false,
    checked: "2026-10-24",
    address: "1000 Woodland Street, Nashville, TN 37206",
    summary: "Rides to Five Points and East Nashville's restaurants, bars and shops, across the river from downtown.",
    dropoff: [
      "Five Points is the junction of Woodland Street, South 11th Street and Clearview Avenue; most of the restaurants and bars sit in the 1000 block of Woodland Street and the first block of South 11th.",
      "There is no posted rideshare zone at Five Points. The junction itself is busy, so a pickup pin a few doors up Woodland Street or South 11th is usually easier for your driver."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Street parking around Five Points is limited and some of it is restricted: a Metro Council memo notes residential permit parking on the 800 and 900 blocks of Russell Street, just off the junction. A ride avoids hunting for a legal space on a weekend night."
    ],
    sources: [
      { label: "Visit Music City: East Nashville", url: "https://www.visitmusiccity.com/meetings/neighborhoods/eastnashville" },
      { label: "Metro Council: Five Points parking memo (2020)", url: "https://www.nashville.gov/sites/default/files/2021-08/201112-memo-withers-five-points.pdf" }
    ],
    related: ["broadway-downtown", "nissan-stadium"]
  },
  {
    slug: "germantown",
    name: "Germantown & the Farmers' Market",
    category: "District",
    cluster: "north",
    events: true,
    checked: "2026-10-24",
    address: "900 Rosa L. Parks Boulevard, Nashville, TN 37208",
    summary: "Rides to Germantown's restaurants, the Nashville Farmers' Market and First Horizon Park, just northwest of downtown.",
    dropoff: [
      "Visit Music City describes Germantown as a historic neighborhood a few blocks northwest of downtown, on the National Register of Historic Places. The Farmers' Market is at 900 Rosa L. Parks Boulevard, next to Bicentennial Capitol Mall State Park.",
      "Germantown's streets are narrow and many buildings are served from the alley, so giving your driver the street address of the restaurant or market house works better than a corner."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "The Nashville Farmers' Market offers free two-hour parking in its own lot and the shared Tennessee State Museum lots along Rosa Parks Boulevard, plus free weekend parking in surrounding state lots (except Lot 29 and the Nashville Sounds garage). Market board minutes note the lot is controlled by security once it fills on weekends, and event days are tighter still."
    ],
    sources: [
      { label: "Visit Music City: Germantown", url: "https://www.visitmusiccity.com/nashville-neighborhoods/germantown" },
      { label: "Nashville Farmers' Market: FAQ (parking)", url: "https://www.nashvillefarmersmarket.org/faq" },
      { label: "Nashville Farmers' Market: Hours and directions", url: "https://www.nashvillefarmersmarket.org/hours-and-directions" }
    ],
    related: ["broadway-downtown", "tennessee-state-university"]
  },
  {
    slug: "midtown-music-row",
    name: "Midtown & Music Row",
    category: "District",
    cluster: "midtown",
    events: false,
    checked: "2026-10-24",
    address: "Music Row Roundabout, 16th Avenue South, Nashville, TN 37203",
    summary: "Rides to Midtown, Music Row and the Demonbreun Street strip, next to Vanderbilt and Centennial Park.",
    dropoff: [
      "Visit Music City places Music Row between the edge of downtown and West End, with Midtown next to Vanderbilt University and close to Centennial Park and the Parthenon. Demonbreun Street is the strip of bars, restaurants and live-music venues.",
      "Demonbreun Street has bike lanes between the Music Row Roundabout (Buddy Killen Circle) and 14th Avenue South, and Metro says stopped vehicles block them often. Ask your driver to use a side street or a driveway rather than the bike lane, and expect lane changes near the roundabout, where striping was altered in June 2025."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Most Music Row studios and offices are in converted houses with small private lots, and Midtown parking is largely metered street spaces, hotel valet and paid lots. A ride avoids the circuit around the roundabout looking for a space."
    ],
    sources: [
      { label: "Visit Music City: Music Row, Demonbreun & Edgehill", url: "https://www.visitmusiccity.com/nashville-neighborhoods/music-row-demonbreun-edgehill" },
      { label: "Metro NDOT: Demonbreun Street bikeway", url: "https://www.nashville.gov/departments/transportation/projects/bikeways/demonbreun-street" }
    ],
    related: ["vanderbilt-university", "parthenon-centennial-park"]
  },
  {
    slug: "tennessee-state-university",
    name: "Tennessee State University",
    category: "University",
    cluster: "north",
    events: false,
    checked: "2026-10-24",
    address: "3500 John A. Merritt Boulevard, Nashville, TN 37209",
    summary: "Rides to TSU's main campus in North Nashville, with no visitor permit to collect.",
    dropoff: [
      "TSU's main campus is on John A. Merritt Boulevard, with security booths at the 33rd Avenue North and Alameda Street entrances. Tell your driver which building you need; the campus is large.",
      "Parking & Traffic Services is in Hankal Hall at 3500 John A. Merritt Boulevard."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book. TSU's parking office (615-963-1482) can confirm accessible parking and the closest entrance to your building."
    ],
    parking: [
      "TSU's parking page says visitors can pay $1 an hour or $5 a day, Monday to Friday, 6 AM to 6 PM, and its traffic policy says occasional visitors must register at the Parking & Traffic Services office or a security booth to get a visitor permit, displayed on the driver's-side dashboard. Parking without the right permit can mean a fine or a tow. A ride means no permit and no lot to find."
    ],
    sources: [
      { label: "TSU: Parking", url: "https://www.tnstate.edu/administration/parking/" },
      { label: "TSU Policy 8.04: Parking and Traffic Regulations", url: "https://www.tnstate.edu/policies/documents/TrafficandParking.pdf" }
    ],
    related: ["fisk-university", "germantown"]
  },
  {
    slug: "fisk-university",
    name: "Fisk University",
    category: "University",
    cluster: "north",
    events: false,
    checked: "2026-10-24",
    address: "1000 17th Avenue North, Nashville, TN 37208",
    summary: "Rides to Fisk University's campus in North Nashville, about two miles from downtown.",
    dropoff: [
      "Fisk says its campus is bounded by Jefferson Street to the north and Jackson and Herman Streets to the south, with the Harry Elson Memorial Gate, just north of Jackson Street at 17th Avenue, as the formal entrance.",
      "Fisk calls itself an open campus and welcomes self-guided visits, with materials from the Office of Admissions and Recruitment; its annual Tour and Visit Day is held at the Henderson A. Johnson Gymnasium, 1000 17th Avenue North."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book. Fisk's admissions office (615-645-7966) can confirm the closest accessible entrance for your visit."
    ],
    parking: [
      "We could not find a current visitor parking page for Fisk; an older student handbook reserves some spaces for campus visitors and warns that parking in unauthorized spaces can be ticketed or towed. Confirm with campus safety or admissions, or take a ride and skip it."
    ],
    sources: [
      { label: "Fisk University: Campus Visit", url: "https://www.fisk.edu/admissions/campus-visit/" },
      { label: "Fisk University: Contact Us", url: "https://www.fisk.edu/contact-us/" }
    ],
    related: ["tennessee-state-university", "germantown"]
  },
  {
    slug: "lipscomb-university",
    name: "Lipscomb University",
    category: "University",
    cluster: "south",
    events: false,
    checked: "2026-10-24",
    address: "One University Park Drive, Nashville, TN 37204",
    summary: "Rides to Lipscomb University's campus in Green Hills, near 12 South.",
    dropoff: [
      "Lipscomb's address is One University Park Drive, and its campus safety office says University Park Drive itself is reserved for guests and faculty or staff, so a drop-off there is usually straightforward.",
      "Lipscomb's campus map marks a Welcome Center; for a visit day, admissions registration starts at 9 AM. Campus Safety is on 615-966-7600."
    ],
    accessibility: [
      "Lipscomb's campus map marks the Arena East garage as ADA parking. If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Lipscomb's campus map lists the Arena East and Arena West garages, a North garage and overflow lots at Caldwell Lane and Stokes School; the numbering differs between map versions, so check the current map. Reserved guest spaces are arranged through its security office rather than taken on arrival."
    ],
    sources: [
      { label: "Lipscomb University: Visit", url: "https://lipscomb.edu/visit-lipscomb" },
      { label: "Lipscomb University: Security FAQs", url: "https://lipscomb.edu/one-stop/security-faqs" },
      { label: "Lipscomb University: Campus parking map (2024)", url: "https://www.lipscomb.edu/sites/default/files/2024-10/ADM%20Lipscomb%20Campus%20Parking%20Map%20-%20Digital.pdf" }
    ],
    related: ["belmont-university", "twelve-south"]
  },
  {
    slug: "wego-central",
    name: "WeGo Central",
    category: "Transit",
    cluster: "downtown",
    events: false,
    checked: "2026-10-24",
    address: "400 Dr. Martin Luther King Jr. Boulevard, Nashville, TN 37219",
    summary: "Rides to and from WeGo Central, the downtown bus station, for the first or last mile of a transit trip.",
    dropoff: [
      "WeGo lists the Elizabeth Duff Transit Center at WeGo Central at 400 Dr. Martin Luther King Jr. Boulevard, next to Municipal Auditorium. One Metro hub page shows a Madison address instead; that appears to be an error.",
      "WeGo's customer service hours are Monday to Friday 6 AM to 6:30 PM, Saturday 8 AM to 5 PM and Sunday 10:30 AM to 2:30 PM; bus service hours differ by route, so check your route before you book a ride to meet it."
    ],
    accessibility: [
      "A 2023 transit board document lists two escalators and one passenger elevator at the station, with two more elevators serving the parking facility, and a service alert has closed the escalators for modernization in the past. Allow extra time for transfers, and add a note for your driver when you book if you use a wheelchair or need extra time getting in."
    ],
    parking: [
      "WeGo Central is next to Municipal Auditorium, where parking is paid and fills on event days. A ride to the door means no car left downtown while you are out on a bus or train."
    ],
    sources: [
      { label: "WeGo Public Transit: Contact Us", url: "https://www.wegotransit.com/contact-us/departments/" },
      { label: "Nashville MTA board book (February 2023)", url: "https://www.wegotransit.com/assets/1/27/Final_MTA_Board_Book_2.23.2023.pdf" }
    ],
    related: ["broadway-downtown", "music-city-center"]
  }
]);

const BY_SLUG = new Map(DESTINATIONS.map((d) => [d.slug, d]));

// Corridor clusters: every page links to the rest of its corridor, and
// the hub is grouped the same way.
const CLUSTERS = Object.freeze([
  { id: "downtown", name: "Downtown & East Bank" },
  { id: "midtown", name: "Midtown & West End" },
  { id: "opryland", name: "Opryland" },
  { id: "south", name: "South Nashville" },
  { id: "east", name: "East Nashville" },
  { id: "north", name: "North Nashville & Germantown" }
]);

// Same corridor first (in list order), then any hand-picked extras.
function relatedFor(d) {
  const sameCluster = DESTINATIONS.filter((x) => x.cluster === d.cluster && x.slug !== d.slug);
  const extras = d.related.map((s) => BY_SLUG.get(s)).filter((x) => x && x.cluster !== d.cluster);
  return [...sameCluster, ...extras];
}

// Three rider questions per page, answered only from the page's own
// sourced content plus what Harvey Taxi's booking screen does (shows a
// fare estimate before you confirm). No pricing promises.
function faqsFor(d) {
  const firstSentence = (text) => String(text).split(/(?<=\.)\s/)[0];
  return [
    {
      q: `Where should I get dropped off or picked up at ${d.name}?`,
      a: `${d.dropoff[0]} ${d.dropoff[1] ? firstSentence(d.dropoff[1]) : ""}`.trim()
    },
    {
      q: d.category === "Medical"
        ? `Can Harvey Taxi help if I need a wheelchair-accessible vehicle to ${d.name}?`
        : `Is ${d.name} accessible, and can I tell my driver what I need?`,
      a: d.accessibility.join(" ")
    },
    {
      q: `How does parking at ${d.name} compare with taking a ride?`,
      a: `${d.parking[0]} Your fare depends on distance and time; the booking screen shows your estimate before you confirm, so you can compare.`
    }
  ];
}

// Shown on event venues: verified, general advice only.
const EVENT_CALLOUT = "Leaving a busy show or match? Every exit is crowded at once, and roads near the venue may be closed. Request your pickup from the venue's posted rideshare area or a quieter street a block or two away, or wait a few minutes for the crowd to thin. You see your fare estimate before you confirm.";
const HUB_PATH = "/nashville-destinations/";
const pagePath = (slug) => `/destinations/${slug}/`;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON inside <script type="application/ld+json">: "<" escaped so no
// value can close the script element.
function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function bookUrl(destination) {
  return `/rider-dashboard.html?ai_destination=${encodeURIComponent(destination.address)}`;
}

function formatDate(iso) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

const STYLE = `
:root{--bg:#07101f;--card:#0f1c33;--line:#22365a;--text:#eef3ff;--muted:#a9b8d6;--accent:#3ad1ff;--gold:#ffd166}
@media (prefers-color-scheme:light){:root{--bg:#f5f8fd;--card:#ffffff;--line:#d6e0f0;--text:#0b1530;--muted:#4a5a78;--accent:#0a6fb3;--gold:#9a6b00}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}main{max-width:820px;margin:0 auto;padding:24px 16px 64px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;max-width:820px;margin:0 auto}
header.top a.brand{color:var(--text);text-decoration:none;font-weight:800}
.crumbs{font-size:.9rem;color:var(--muted)}.crumbs a{color:var(--muted)}
h1{font-size:1.9rem;line-height:1.2;margin:.4em 0}h2{font-size:1.25rem;margin:1.6em 0 .5em}
.lead{color:var(--muted);font-size:1.05rem}.addr{font-weight:600}
.cta{display:inline-block;margin:12px 0;padding:12px 18px;border-radius:12px;background:var(--accent);color:#04111f;font-weight:800;text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
.note{font-size:.9rem;color:var(--muted)}ul{padding-left:1.2em}li{margin:.35em 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.grid a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;text-decoration:none;color:var(--text)}
.grid small{display:block;color:var(--muted)}
h3{font-size:1.02rem;margin:1em 0 .2em}.callout{border-color:var(--gold)}
footer{max-width:820px;margin:0 auto;padding:24px 16px;color:var(--muted);font-size:.9rem}`;

function layout({ title, description, canonicalPath, body, ld }) {
  const canonical = `${SITE}${canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<link rel="icon" href="/favicon.ico" />
<style>${STYLE}</style>
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
</head>
<body>
<header class="top"><a class="brand" href="/">Harvey Taxi</a><a href="${HUB_PATH}">Nashville destinations</a></header>
<main>
${body}
</main>
<footer>
<p>Harvey Taxi Service LLC, Nashville, Tennessee. Rides in Nashville (early access). Venue details are from each venue's own website; each page shows the date it was checked. Venues change entrances and zones for events, so confirm on the day.</p>
<p><a href="/">Home</a> · <a href="${HUB_PATH}">All destinations</a> · <a href="/support.html">Support</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</footer>
</body>
</html>`;
}

const PROVIDER = { "@type": "LocalBusiness", name: "Harvey Taxi Service LLC", url: SITE };

function breadcrumbs(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE}${it.path}` }))
  };
}

function clusterName(id) {
  const c = CLUSTERS.find((x) => x.id === id);
  return c ? c.name : "Nashville";
}

function list(items) {
  return `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

// travelTimes: [{ originId, minutes, miles }] or null when unavailable.
function travelTable(travelTimes) {
  const rows = (travelTimes || [])
    .map((t) => ({ t, origin: ORIGINS.find((o) => o.id === t.originId) }))
    .filter(({ t, origin }) => origin && Number.isFinite(t.minutes) && Number.isFinite(t.miles));
  if (!rows.length) {
    return `<p class="note">Open the booking screen for a live route and fare estimate from where you are.</p>`;
  }
  return `<table><thead><tr><th>From</th><th>Typical drive (no traffic)</th><th>Distance</th></tr></thead><tbody>${rows
    .map(({ t, origin }) => `<tr><td>${esc(origin.label)}</td><td>about ${Math.max(1, Math.round(t.minutes))} min</td><td>${t.miles.toFixed(1)} mi</td></tr>`)
    .join("")}</tbody></table>
<p class="note">Estimated driving routes from Mapbox without live traffic. Event traffic and closures add time.</p>`;
}

function renderDestinationPage(slug, { travelTimes = null } = {}) {
  const d = BY_SLUG.get(slug);
  if (!d) return null;
  const path = pagePath(slug);
  const title = `Rides to ${d.name}, Nashville | Harvey Taxi`;
  const description = `${d.summary} Drop-off tips, accessibility and parking notes, and a live fare estimate.`.slice(0, 300);
  const related = relatedFor(d);
  const faqs = faqsFor(d);
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="${HUB_PATH}">Nashville destinations</a> › ${esc(d.name)}</nav>
<h1>Rides to ${esc(d.name)}</h1>
<p class="lead">${esc(d.summary)}</p>
<p class="addr">${esc(d.address)}</p>
<a class="cta" href="${esc(bookUrl(d))}">Get a live fare estimate</a>
<section class="card"><h2>Drop-off and pickup</h2>${list(d.dropoff)}</section>
<section class="card"><h2>Travel times</h2>${travelTable(travelTimes)}</section>
<section class="card"><h2>Accessibility</h2>${list(d.accessibility)}</section>
<section class="card"><h2>Parking compared with a ride</h2>${list(d.parking)}<p class="note">Fares depend on distance and time; the booking screen shows your estimate before you confirm.</p></section>
<section class="card"><h2>Sources</h2><ul>${d.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`).join("")}</ul><p class="note">Checked ${esc(formatDate(d.checked || CHECKED_ON))}. Venues update entrances and zones; confirm with the venue on the day.</p></section>
${d.events ? `<section class="card callout"><h2>Leaving after an event</h2><p>${esc(EVENT_CALLOUT)}</p></section>` : ""}
<section class="card"><h2>Rider questions</h2>${faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</section>
${related.length ? `<h2>More in ${esc(clusterName(d.cluster))}${related.some((r) => r.cluster !== d.cluster) ? " and nearby" : ""}</h2><div class="grid">${related.map((r) => `<a href="${pagePath(r.slug)}">${esc(r.name)}<small>${esc(r.category)}</small></a>`).join("")}</div>` : ""}`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "TaxiService",
      name: `Harvey Taxi Service: rides to ${d.name}`,
      url: `${SITE}${path}`,
      provider: PROVIDER,
      areaServed: {
        "@type": "Place",
        name: `${d.name}, Nashville, TN`,
        address: { "@type": "PostalAddress", streetAddress: d.address.split(",")[0], addressLocality: "Nashville", addressRegion: "TN", addressCountry: "US" }
      }
    },
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Nashville destinations", path: HUB_PATH }, { name: d.name, path }]),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
    }
  ];
  return layout({ title, description, canonicalPath: path, body, ld });
}

function renderHubPage() {
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Nashville destinations</nav>
<h1>Rides to popular Nashville destinations</h1>
<p class="lead">Drop-off spots, accessibility and parking notes for the places riders go most: venues, hospitals, neighborhoods, campuses and the downtown bus station, from each place's own website.</p>
${CLUSTERS.map((c) => {
    const items = DESTINATIONS.filter((d) => d.cluster === c.id);
    return items.length ? `<h2>${esc(c.name)}</h2><div class="grid">${items.map((d) => `<a href="${pagePath(d.slug)}">${esc(d.name)}<small>${esc(d.category)} · ${esc(d.address)}</small></a>`).join("")}</div>` : "";
  }).join("\n")}
<a class="cta" href="/rider-dashboard.html">Book a ride</a>`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Nashville destinations served by Harvey Taxi",
      itemListElement: DESTINATIONS.map((d, i) => ({ "@type": "ListItem", position: i + 1, name: d.name, url: `${SITE}${pagePath(d.slug)}` }))
    },
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Nashville destinations", path: HUB_PATH }])
  ];
  return layout({
    title: "Rides to Nashville destinations | Harvey Taxi",
    description: "Harvey Taxi ride guides for Nashville: Broadway, the Ryman, Bridgestone Arena, Music City Center, the Opry, Nissan Stadium, GEODIS Park, the Parthenon, the Nashville Zoo, Vanderbilt and Nashville's hospitals.",
    canonicalPath: HUB_PATH,
    body,
    ld
  });
}

const SITEMAP_PATHS = Object.freeze([HUB_PATH, ...DESTINATIONS.map((d) => pagePath(d.slug))]);

module.exports = {
  CHECKED_ON,
  CLUSTERS,
  faqsFor,
  DESTINATIONS,
  HUB_PATH,
  ORIGINS,
  SITEMAP_PATHS,
  pagePath,
  renderDestinationPage,
  renderHubPage
};
