var express = require('express');
var router = express.Router();
const OpenAI = require('openai');
const multer = require('multer');

// const openai = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// POST route to analyze an uploaded image
router.post('/object', async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: `No image file, only received: ${req.body}` });
          }

        const style = req.body.style;
        const base64image = req.body.file;
        
        const titleResponse = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
            {
                role: "user",
                content: [
                { type: "text", text: "What is in this image in three words or less?" },
                {
                    type: "image_url",
                    image_url: {
                        "url": `data:image/jpeg;base64,${base64image}`,
                        "detail": "low"
                    },
                    
                },
                ],
            },
            ],
            max_tokens: 50,
        });

        const quantityResponse = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
            {
                role: "user",
                content: [
                { type: "text", text: "How many objects are in this image? Please only respond with the number." },
                {
                    type: "image_url",
                    image_url: {
                        "url": `data:image/jpeg;base64,${base64image}`,
                        "detail": "low"
                    },
                    
                },
                ],
            },
            ],
            max_tokens: 300,
        });

        const descriptionResponse = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [
            {
                role: "user",
                content: [
                { type: "text", text: "Can you describe this item in the style of an " + style + "with details like color, quantity, quality, size, dates, etc? Please use 100 words or less." },
                {
                    type: "image_url",
                    image_url: {
                        "url": `data:image/jpeg;base64,${base64image}`,
                        "detail": "low"
                    },
                    
                },
                ],
            },
            ],
            max_tokens: 256,
        });

        // const tagsResponse = await openai.chat.completions.create({
        //     model: "gpt-4-vision-preview",
        //     messages: [
        //     {
        //         role: "user",
        //         content: [
        //         { type: "text", text: "What are 5-10 one word descriptive tags you would associate with this item? Please separate each word with a semicolon." },
        //         {
        //             type: "image_url",
        //             image_url: {
        //                 "url": `data:image/jpeg;base64,${base64image}`,
        //                 "detail": "low"
        //             },
                    
        //         },
        //         ],
        //     },
        //     ],
        //     max_tokens: 50,
        // });

        res.status(200).send({ titleResponse, quantityResponse, descriptionResponse});
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }

  });

  router.post('/bookshelf', async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json({ error: `No data, only received: ${req.body}` });
          }

        const bookString = req.body.string;
        
        const booksResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo-1106",
            response_format: { type: "json_object" },
            
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant designed to catalog individual books.",
                },
                {
                    role: "user",
                    content: [
                    { type: "text", text: "Please create a new book JSON object for every title you recognize in the string of text between ` characters." 
                    + "Please extrapolate to the full title and author even if not captured in this string. Each object entry should have the following format: book: { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', publisher: 'Scribner' }"
                    + "Please also do not include any extraneous explanations."
                    + "For each group of words that do not belong to the information of a book, please extract to an object entry of the following format: rare: { text: 'text that wasn't used' }`"
                    + "All instances of a 'rare' object should be places after all 'book' objects."
                    + "`" + bookString + "`" },
                    ],
                },
            ],
            // tools: [
            //     {
            //       type: "function",
            //       function: {
            //         name: "get_book_data",
            //         description: "Get the information for a specific book identified in a string",
            //         parameters: {
            //           type: "object",
            //           properties: {
            //             title: { 
            //                 type: "string", 
            //                 description: "The full title of a publication based on key words identified in a string of text" 
            //             },
            //             author: {
            //                 type: "string",
            //                 description: "The author of a the publication that was identified",
            //             },
            //             publisher: { 
            //                 type: "string", 
            //                 description: "The specific publisher of a publication or 'unknown' if not available" 
            //             },
            //           },
            //           required: ["author", "title", "publisher"],
            //         },
            //       },
            //     },
            // ],
            max_tokens: 1000,


            // "Sure, I'll provide you with JSON entries for each book visible in the image. However, the details such as author and publisher may not be fully visible for some books, so the entries may be incomplete:\n\n```json\n[\n  {\n    \""


            // response_format: { type: "json_object" },

            // functions: [
            //     {
            //         name: "createItemObject",
            //         parameters: {
            //             type: "object",
            //             properties: {
            //                 title: {
            //                     type: "string"
            //                 },
            //                 author: {
            //                     type: "string",
            //                 },
            //                 publisher: {
            //                     type: "string"
            //                 }
            //             },
            //             required: ["title", "author"]
            //         }
            //     }
            // ],
            // function_call: { name: "createItemObject" },
            
        });

        res.status(200).send({ booksResponse });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }

  });
  
module.exports = router;


// import OpenAI from "openai";

// const openai = new OpenAI();

// async function main() {
//   const messages = [{"role": "user", "content": "What's the weather like in Boston today?"}];
//   const tools = [
//       {
//         "type": "function",
//         "function": {
//           "name": "get_current_weather",
//           "description": "Get the current weather in a given location",
//           "parameters": {
//             "type": "object",
//             "properties": {
//               "location": {
//                 "type": "string",
//                 "description": "The city and state, e.g. San Francisco, CA",
//               },
//               "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
//             },
//             "required": ["location"],
//           },
//         }
//       }
//   ];

//   const response = await openai.chat.completions.create({
//     model: "gpt-3.5-turbo",
//     messages: messages,
//     tools: tools,
//     tool_choice: "auto",
//   });

//   console.log(response);
// }

// main();