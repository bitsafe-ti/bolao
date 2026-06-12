export const venuesByGround = {
  Atlanta: { city: "Atlanta", stadium: "Mercedes-Benz Stadium", country: "Estados Unidos" },
  "Boston (Foxborough)": { city: "Foxborough", stadium: "Gillette Stadium", country: "Estados Unidos" },
  "Dallas (Arlington)": { city: "Arlington", stadium: "AT&T Stadium", country: "Estados Unidos" },
  "Guadalajara (Zapopan)": { city: "Zapopan", stadium: "Estadio Akron", country: "México" },
  Houston: { city: "Houston", stadium: "NRG Stadium", country: "Estados Unidos" },
  "Kansas City": { city: "Kansas City", stadium: "Arrowhead Stadium", country: "Estados Unidos" },
  "Los Angeles (Inglewood)": { city: "Inglewood", stadium: "SoFi Stadium", country: "Estados Unidos" },
  "Mexico City": { city: "Cidade do México", stadium: "Estadio Azteca", country: "México" },
  "Miami (Miami Gardens)": { city: "Miami Gardens", stadium: "Hard Rock Stadium", country: "Estados Unidos" },
  "Monterrey (Guadalupe)": { city: "Guadalupe", stadium: "Estadio BBVA", country: "México" },
  "New York/New Jersey (East Rutherford)": {
    city: "East Rutherford",
    stadium: "MetLife Stadium",
    country: "Estados Unidos"
  },
  Philadelphia: { city: "Filadélfia", stadium: "Lincoln Financial Field", country: "Estados Unidos" },
  "San Francisco Bay Area (Santa Clara)": {
    city: "Santa Clara",
    stadium: "Levi's Stadium",
    country: "Estados Unidos"
  },
  Seattle: { city: "Seattle", stadium: "Lumen Field", country: "Estados Unidos" },
  Toronto: { city: "Toronto", stadium: "BMO Field", country: "Canadá" },
  Vancouver: { city: "Vancouver", stadium: "BC Place", country: "Canadá" }
};

export function getVenueByGround(ground) {
  return venuesByGround[ground] ?? { city: ground || "", stadium: "", country: "" };
}
