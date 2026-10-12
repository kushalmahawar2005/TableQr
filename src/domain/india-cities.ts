// Indian cities and towns for the city box: type "jai" and Jaipur, Jaisalmer come up. Grouped by
// state as "City,City|State". Pure data, searched in the browser.

const BY_STATE = `Agra,Aligarh,Allahabad,Prayagraj,Ayodhya,Bareilly,Ghaziabad,Gorakhpur,Jhansi,Kanpur,Lucknow,Mathura,Meerut,Moradabad,Noida,Greater Noida,Saharanpur,Varanasi,Vrindavan,Firozabad,Muzaffarnagar,Rampur,Shahjahanpur,Etawah,Mirzapur,Bulandshahr,Hapur,Sitapur,Faizabad,Basti,Azamgarh,Ballia,Deoria,Jaunpur,Banda,Lalitpur,Unnao,Rae Bareli,Sultanpur,Hardoi,Budaun,Pilibhit,Bijnor,Amroha,Kannauj,Mainpuri,Etah,Gonda,Bahraich|Uttar Pradesh
Jaipur,Jodhpur,Udaipur,Kota,Ajmer,Bikaner,Alwar,Bhilwara,Sikar,Bharatpur,Pali,Sri Ganganagar,Tonk,Jhunjhunu,Chittorgarh,Jaisalmer,Barmer,Nagaur,Churu,Hanumangarh,Dausa,Sawai Madhopur,Bundi,Banswara,Dungarpur,Pushkar,Mount Abu,Kishangarh,Beawar,Neemrana,Bhiwadi,Karauli,Dholpur,Jhalawar,Baran,Rajsamand,Sirohi,Jalore,Pratapgarh,Kotputli|Rajasthan
Mumbai,Navi Mumbai,Thane,Pune,Nagpur,Nashik,Aurangabad,Chhatrapati Sambhajinagar,Solapur,Kolhapur,Amravati,Nanded,Sangli,Satara,Jalgaon,Akola,Latur,Dhule,Ahmednagar,Chandrapur,Parbhani,Ichalkaranji,Jalna,Bhiwandi,Panvel,Kalyan,Dombivli,Vasai,Virar,Mira Bhayandar,Ulhasnagar,Lonavala,Mahabaleshwar,Alibag,Ratnagiri,Wardha,Yavatmal,Gondia,Bhandara,Beed,Osmanabad,Baramati,Shirdi|Maharashtra
Ahmedabad,Surat,Vadodara,Rajkot,Bhavnagar,Jamnagar,Gandhinagar,Junagadh,Anand,Nadiad,Morbi,Mehsana,Bharuch,Vapi,Navsari,Valsad,Porbandar,Bhuj,Gandhidham,Palanpur,Surendranagar,Godhra,Dwarka,Somnath,Ankleshwar,Amreli,Botad,Patan|Gujarat
Bengaluru,Bangalore,Mysuru,Mysore,Mangaluru,Mangalore,Hubballi,Hubli,Dharwad,Belagavi,Belgaum,Kalaburagi,Gulbarga,Davanagere,Ballari,Bellary,Vijayapura,Shivamogga,Tumakuru,Udupi,Hassan,Mandya,Chitradurga,Raichur,Bidar,Hospet,Gadag,Kolar,Chikkamagaluru,Coorg,Madikeri,Karwar,Manipal,Hampi|Karnataka
Chennai,Coimbatore,Madurai,Tiruchirappalli,Trichy,Salem,Tirunelveli,Tiruppur,Erode,Vellore,Thoothukudi,Tuticorin,Thanjavur,Dindigul,Kanchipuram,Karur,Hosur,Nagercoil,Kumbakonam,Cuddalore,Ooty,Kodaikanal,Rameswaram,Pollachi,Sivakasi,Namakkal,Tiruvannamalai,Mahabalipuram,Krishnagiri,Pudukkottai|Tamil Nadu
Hyderabad,Secunderabad,Warangal,Nizamabad,Karimnagar,Khammam,Ramagundam,Mahbubnagar,Nalgonda,Adilabad,Siddipet,Suryapet,Miryalaguda,Jagtial,Mancherial|Telangana
Visakhapatnam,Vizag,Vijayawada,Guntur,Nellore,Kurnool,Rajahmundry,Kakinada,Tirupati,Anantapur,Kadapa,Eluru,Ongole,Vizianagaram,Machilipatnam,Srikakulam,Chittoor,Amaravati,Puttaparthi,Bhimavaram,Tenali|Andhra Pradesh
Kochi,Cochin,Thiruvananthapuram,Trivandrum,Kozhikode,Calicut,Thrissur,Kollam,Kannur,Alappuzha,Alleppey,Palakkad,Kottayam,Malappuram,Kasaragod,Munnar,Wayanad,Varkala,Kovalam,Pathanamthitta,Idukki,Guruvayur|Kerala
Kolkata,Howrah,Durgapur,Asansol,Siliguri,Bardhaman,Kharagpur,Haldia,Darjeeling,Kalimpong,Malda,Baharampur,Krishnanagar,Jalpaiguri,Cooch Behar,Digha,Shantiniketan,Bolpur,Barasat,Salt Lake|West Bengal
New Delhi,Delhi|Delhi
Gurugram,Gurgaon,Faridabad,Panipat,Ambala,Karnal,Hisar,Rohtak,Sonipat,Yamunanagar,Panchkula,Bhiwani,Sirsa,Rewari,Kurukshetra,Jind,Kaithal,Palwal,Bahadurgarh,Jhajjar,Fatehabad,Narnaul,Manesar|Haryana
Ludhiana,Amritsar,Jalandhar,Patiala,Bathinda,Mohali,Hoshiarpur,Pathankot,Moga,Firozpur,Phagwara,Kapurthala,Rajpura,Zirakpur,Barnala,Sangrur,Faridkot,Muktsar,Abohar,Anandpur Sahib|Punjab
Chandigarh|Chandigarh
Indore,Bhopal,Jabalpur,Gwalior,Ujjain,Sagar,Satna,Rewa,Ratlam,Dewas,Burhanpur,Khandwa,Chhindwara,Morena,Singrauli,Katni,Bhind,Shivpuri,Vidisha,Guna,Mandsaur,Neemuch,Hoshangabad,Narmadapuram,Pachmarhi,Khajuraho,Omkareshwar,Maheshwar,Itarsi,Damoh,Chhatarpur|Madhya Pradesh
Raipur,Bhilai,Durg,Bilaspur,Korba,Rajnandgaon,Raigarh,Jagdalpur,Ambikapur,Dhamtari|Chhattisgarh
Patna,Gaya,Bhagalpur,Muzaffarpur,Darbhanga,Purnia,Arrah,Begusarai,Katihar,Munger,Chapra,Sasaram,Hajipur,Bihar Sharif,Motihari,Siwan,Bettiah,Bodh Gaya,Rajgir,Nalanda|Bihar
Ranchi,Jamshedpur,Dhanbad,Bokaro,Deoghar,Hazaribagh,Giridih,Ramgarh,Dumka,Phusro|Jharkhand
Bhubaneswar,Cuttack,Rourkela,Berhampur,Sambalpur,Puri,Balasore,Bhadrak,Baripada,Jharsuguda,Konark|Odisha
Guwahati,Silchar,Dibrugarh,Jorhat,Nagaon,Tinsukia,Tezpur,Bongaigaon,Kaziranga|Assam
Dehradun,Haridwar,Rishikesh,Haldwani,Roorkee,Rudrapur,Kashipur,Nainital,Mussoorie,Almora,Pithoragarh,Kotdwar|Uttarakhand
Shimla,Manali,Dharamshala,Mandi,Solan,Kullu,Kasauli,Dalhousie,Palampur,Hamirpur,Una,Bilaspur HP,Chamba,Kasol,McLeod Ganj|Himachal Pradesh
Srinagar,Jammu,Anantnag,Baramulla,Gulmarg,Pahalgam,Katra,Udhampur,Sonamarg|Jammu and Kashmir
Leh,Kargil|Ladakh
Panaji,Margao,Vasco da Gama,Mapusa,Ponda,Calangute,Baga,Anjuna,Candolim,Arambol,Palolem|Goa
Puducherry,Pondicherry,Karaikal|Puducherry
Imphal|Manipur
Shillong,Tura|Meghalaya
Aizawl|Mizoram
Kohima,Dimapur|Nagaland
Agartala|Tripura
Gangtok,Pelling|Sikkim
Itanagar,Tawang|Arunachal Pradesh
Port Blair|Andaman and Nicobar Islands
Daman,Silvassa,Diu|Dadra and Nagar Haveli and Daman and Diu
Kavaratti|Lakshadweep`;

export type IndiaCity = { name: string; state: string };

export const INDIA_CITIES: IndiaCity[] = BY_STATE.split("\n").flatMap((line) => {
  const [names, state] = line.split("|");
  return names.split(",").map((name) => ({ name: name.trim(), state: state.trim() }));
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Cities for what was typed: names starting with it first, then names containing it */
export function searchCities(query: string, limit = 8): IndiaCity[] {
  const q = norm(query);
  if (!q) return [];
  const starts = INDIA_CITIES.filter((c) => norm(c.name).startsWith(q));
  const contains = INDIA_CITIES.filter((c) => !norm(c.name).startsWith(q) && (norm(c.name).includes(q) || norm(c.state).startsWith(q)));
  return [...starts, ...contains].slice(0, limit);
}
