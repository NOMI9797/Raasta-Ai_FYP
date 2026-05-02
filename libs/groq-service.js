import OpenAI from 'openai';

// Initialize Groq client using OpenAI SDK
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || '',
  baseURL: 'https://api.groq.com/openai/v1',
});

// Available Groq models (commonly supported models)
export const GROQ_MODELS = {
  'llama-3.1-8b-instant': 'Llama 3.1 8B (Fast)', 
  'llama3-8b-8192': 'Llama 3 8B',
  'mixtral-8x7b-32768': 'Mixtral 8x7B',
  'gemma-7b-it': 'Gemma 7B',
};

export async function generatePersonalizedMessage({
  leadName,
  leadTitle,
  leadCompany,
  posts,
  customPrompt,
  model = 'llama-3.1-8b-instant',
}) {
  try {
    // Prepare posts context
    const postsContext = posts
      .slice(0, 3) // Analyze top 3 posts
      .map((post, index) => {
        const date = new Date(post.timestamp).toLocaleDateString();
        return `Post ${index + 1} (${date}): ${post.content.slice(0, 500)}...`;
      })
      .join('\n\n');

    // Build the system prompt
    const systemPrompt = `You are an expert at writing personalized LinkedIn outreach messages. 
Your task is to write a highly personalized, engaging message based on the lead's recent LinkedIn posts.
The message should:
- Reference specific content from their posts to show genuine interest
- Be professional yet conversational
- Be concise (under 150 words)
- Include a clear but soft call-to-action
- Feel authentic and not templated
- Start directly with the message content (no introductory text or prefixes)
- Be ready to send as-is
${customPrompt ? `\nAdditional instructions: ${customPrompt}` : ''}`;

    // Build the user prompt
    const userPrompt = `Write a personalized LinkedIn outreach message to ${leadName}${leadTitle ? ` (${leadTitle}` : ''}${leadCompany ? ` at ${leadCompany}` : ''}${leadTitle ? ')' : ''}.

Their recent LinkedIn posts:
${postsContext}

Write the message directly without any prefixes, introductions, or explanations. Just the message content that can be sent immediately.`;

    // Generate message using Groq
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      temperature: 0.7,
      max_tokens: 500,
    });

    const message = completion.choices[0]?.message?.content;
    
    if (!message) {
      throw new Error('No message generated');
    }

    // Clean up any unwanted prefixes that might slip through
    let cleanedMessage = message.trim();
    
    // Remove common prefixes
    const prefixesToRemove = [
      /^Here's a personalized LinkedIn message for [^:]*:\s*/i,
      /^Here's a personalized LinkedIn message:\s*/i,
      /^Personalized LinkedIn message:\s*/i,
      /^LinkedIn message:\s*/i,
      /^Message:\s*/i,
      /^Here's the message:\s*/i,
      /^Here's a message:\s*/i,
    ];
    
    for (const prefix of prefixesToRemove) {
      cleanedMessage = cleanedMessage.replace(prefix, '');
    }
    
    return cleanedMessage.trim();
  } catch (error) {
    console.error('Error generating message with Groq:', error);
    throw new Error(`Failed to generate message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Streaming version of message generation
export async function generatePersonalizedMessageStream({
  leadName,
  leadTitle,
  leadCompany,
  posts,
  customPrompt,
  model = 'llama-3.1-8b-instant',
  onChunk
}) {
  try {
    // Prepare posts context
    const postsContext = posts
      .slice(0, 3) // Analyze top 3 posts
      .map((post, index) => {
        const date = new Date(post.timestamp).toLocaleDateString();
        return `Post ${index + 1} (${date}): ${post.content.slice(0, 500)}...`;
      })
      .join('\n\n');

    // Build the system prompt
    const systemPrompt = `You are an expert at writing personalized LinkedIn outreach messages. 
Your task is to write a highly personalized, engaging message based on the lead's recent LinkedIn posts.
The message should:
- Reference specific content from their posts to show genuine interest
- Be professional yet conversational
- Be concise (under 150 words)
- Include a clear but soft call-to-action
- Feel authentic and not templated
- Start directly with the message content (no introductory text or prefixes)
- Be ready to send as-is
${customPrompt ? `\nAdditional instructions: ${customPrompt}` : ''}`;

    // Build the user prompt
    const userPrompt = `Write a personalized LinkedIn outreach message to ${leadName}${leadTitle ? ` (${leadTitle}` : ''}${leadCompany ? ` at ${leadCompany}` : ''}${leadTitle ? ')' : ''}.

Their recent LinkedIn posts:
${postsContext}

Write the message directly without any prefixes, introductions, or explanations. Just the message content that can be sent immediately.`;

    // Generate streaming message using Groq
    const stream = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    });

    let fullMessage = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullMessage += content;
        // Call the onChunk callback for each piece of content
        if (onChunk) {
          onChunk(content);
        }
      }
    }

    // Clean up any unwanted prefixes that might slip through
    let cleanedMessage = fullMessage.trim();
    
    // Remove common prefixes
    const prefixesToRemove = [
      /^Here's a personalized LinkedIn message for [^:]*:\s*/i,
      /^Here's a personalized LinkedIn message:\s*/i,
      /^Personalized LinkedIn message:\s*/i,
      /^LinkedIn message:\s*/i,
      /^Message:\s*/i,
      /^Here's the message:\s*/i,
      /^Here's a message:\s*/i,
    ];
    
    for (const prefix of prefixesToRemove) {
      cleanedMessage = cleanedMessage.replace(prefix, '');
    }
    
    return cleanedMessage.trim();
  } catch (error) {
    console.error('Error generating streaming message with Groq:', error);
    throw new Error(`Failed to generate message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Outreach for Rozee job-listing leads (B2B: pitch to hiring company).
 * Uses only facts from the provided context — no invented company research.
 */
export async function generateRozeeJobLeadOutreach({
  tier,
  personalizationMode,
  companyName,
  jobTitle,
  location,
  jobDescriptionExcerpt,
  skills,
  suggestedChannel,
  companyResearchSummary,
  icpSummary,
  customPrompt,
  model = 'llama-3.1-8b-instant',
}) {
  const facts = [
    companyName && `Company name (from posting): ${companyName}`,
    jobTitle && `Open role: ${jobTitle}`,
    location && `Location: ${location}`,
    Array.isArray(skills) && skills.length && `Tech / skills mentioned: ${skills.slice(0, 12).join(', ')}`,
    jobDescriptionExcerpt && `Job description excerpt:\n${jobDescriptionExcerpt.slice(0, 2500)}`,
    companyResearchSummary && `Company website research:\n${companyResearchSummary.slice(0, 2200)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const tierNote =
    personalizationMode === 'company_focused' || tier === 'A'
      ? 'Lead tier A: emphasize how your offer fits the company’s likely needs and this hire; still only use facts above.'
      : 'Lead tier B/C: keep it shorter; anchor on the role and stack from the posting.';

  const channelNote =
    suggestedChannel === 'email'
      ? 'Write as a professional email (subject line optional on second line after blank line if useful).'
      : 'Write as a short LinkedIn-style DM (no subject).';

  const systemPrompt = `You write B2B outreach to hiring companies found via job boards.
Rules:
- Use ONLY information from the FACTS block. Do not invent revenue, team size, awards, or services the company offers.
- Be concise (under 180 words unless the user asks otherwise).
- One clear, soft call-to-action (e.g. short call or reply).
- Professional, human tone — not salesy spam.
- Output ONLY the message body ready to send (no "Here is a message" preamble).
${tierNote}
${channelNote}
${icpSummary ? `\nSender / offer context (use lightly, do not contradict FACTS):\n${icpSummary}` : ''}
${customPrompt ? `\nExtra instructions: ${customPrompt}` : ''}`;

  const userPrompt = `FACTS:\n${facts || '(no facts — ask for more context in one sentence)'}\n\nWrite the outreach message.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model,
      temperature: 0.65,
      max_tokens: 600,
    });
    const message = completion.choices[0]?.message?.content;
    if (!message) throw new Error('No message generated');
    return message.trim();
  } catch (error) {
    console.error('Error generating Rozee outreach with Groq:', error);
    throw new Error(
      `Failed to generate outreach: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// Function to validate Groq API key
export async function validateGroqApiKey() {
  try {
    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'llama-3.1-8b-instant',
      max_tokens: 5,
    });
    return !!response.choices[0]?.message?.content;
  } catch (error) {
    console.error('Groq API validation failed:', error);
    return false;
  }
}