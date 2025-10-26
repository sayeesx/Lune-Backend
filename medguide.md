The AI should act as a smart medicine assistant that:


Understands user queries in natural language


Extracts the medicine name, type, or other filters from the query


Fetches relevant information from your MongoDB medicines collection


Responds with all available details: price, manufacturer, type, pack size, composition, alternatives, etc.


If the info isn’t in the database, clearly tells the user: “Sorry, we don’t have that information.”


Step 1: Workflow Overview


User Query Input


User asks: “What is the price of Paracetamol by ABC Pharma?”


AI Analysis Mistral


Parse query to extract intent and medicine info:


medicine_name → “Paracetamol”


manufacturer → “ABC Pharma”


query_type → price, composition, alternatives


Database Query (MongoDB)


Use extracted info to query your collection:


Generate AI Response


Feed database result + original user query into Mistral prompt:


If info exists → summarize all relevant fields in natural language


If no info → reply politely: “I didn’t find that information in our database.”


Send Response to User


JSON response in your API → React Native app → display in chat interface


Performance


Consider caching popular medicine queries to reduce API calls


Fallback


Always include a fallback: “Sorry, we couldn’t find the details you asked for.”


Optional Improvements


Add alternative medicines logic: fetch other medicines with same composition


Limit AI response length for mobile-friendly display