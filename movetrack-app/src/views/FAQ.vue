<template>
    <div class="text-weight-medium text-h5">
        Frequently Asked Questions
    </div>
      <!-- <q-card class="q-my-sm" v-for="(faq, index) in faqs" :key="index" >
        <q-card-section class="text-h6">{{ faq.question }}</q-card-section>
        <q-card-section class="text-caption text-weight-thin">{{ faq.answer }}</q-card-section>
      </q-card> -->
      <q-card class="q-my-sm">
        <q-card-section class="text-h6">How is the skwurlit marketplace different from other online marketplaces?</q-card-section>
        <q-card-section class="text-caption text-weight-thin">Most major marketplaces you are likely to encounter (eBay, Facebook marketplace, Poshmark, etc.) rely on a 3rd party intermediate 
            to govern the transactions you are conducting. All transactions conducted on the skwurlit marketplace are governed by a transparent contract 
            on the blockchain with as few points of intervention as possible.</q-card-section>
      </q-card>
      <q-card class="q-my-sm">
        <q-card-section class="text-h6">How can you guarantee the security of these transactions?</q-card-section>
        <q-card-section class="text-caption text-weight-thin">All of our transaction logic is hard-coded into the contract and this logic is shared publicly. If you would like to learn more about
            the safeguards we have in place, please read through the documentation for each contract type.</q-card-section>
      </q-card>
      <q-card class="q-my-sm">
        <q-card-section class="text-h6">How fast are transactions processed in the marketplace?</q-card-section>
        <q-card-section class="text-caption text-weight-thin">The speed of transactions in our blockchain-based marketplace depends on the underlying blockchain technology. Each 
            step in a transaction (listing, offers, approval, etc.) requires interacting with the blockchain, and each transaction requires 
            confirmation in a new block on the blockchain. On the Ethereum blockchain, which our platform primarily uses, the average block 
            time is approximately 13-15 seconds. However, this can vary due to network congestion and other factors. It's important to note that 
            while blockchain transactions offer enhanced security and transparency, they might not be as instant as traditional digital transactions. 
            For more detailed and up-to-date information on Ethereum block times, please visit the <a href="https://ethereum.org/developers/docs/blocks#block-time" target="_blank" rel="noopener noreferrer">Ethereum</a> or 
            <a href="https://etherscan.io/chart/blocktime" target="_blank" rel="noopener noreferrer">Etherscan</a> websites.
        </q-card-section>
        <q-card-section class="text-caption text-weight-thin">
            For shipment of physical items, this is at the discretion of the seller and dependent upon the type of transaction being conducted. For instance, for an
            Unlimited Auction Contract, the seller cannot withdraw funds until 30 days have elapsed. If you do not receive your item within this time period, you can 
            place a freeze on the transaction and contact support for resolution. For further details on each transaction type, please see that transactions deep dive page.
        </q-card-section>
      </q-card>
      <q-card class="q-my-sm">
        <q-card-section class="text-h6">Why don't you store information on a public or private hosting service?</q-card-section>
        <q-card-section class="text-caption text-weight-thin">
            Some tokens are on chain others remain 
        </q-card-section>
      </q-card>
  </template>
  
  <script lang="ts" setup>
  import { ref } from 'vue';
  
  type Faq = {
    question: string;
    answer: string;
  };
  
  const faqs = ref<Faq[]>([
  {
    question: 'How is the skwurlit marketplace different from other online marketplaces?',
    answer: `Most major marketplaces you are likely to encounter (eBay, Facebook marketplace, Poshmark, etc.) rely on a 3rd party intermediate 
    to govern the transactions you are conducting. All transactions conducted on the skwurlit marketplace are governed by a transparent contract 
    on the blockchain with as few points of intervention as possible.`
  },
  {
    question: 'How can you guarantee the fidelity and security of these transactions?',
    answer: `All of our transaction logic is hard-coded into the contract and this logic is shared publicly. If you would like to learn more about
    the safeguards we have in place, please read through the documentation for each contract type.`
  },
  {
    question: 'How fast are transactions processed in the marketplace?',
    answer: `The speed of transactions in our blockchain-based marketplace depends on the underlying blockchain technology. Each 
    step in a transaction (listing, offers, approval, etc.) requires interacting with the blockchain, and each transaction requires 
    confirmation in a new block on the blockchain. On the Ethereum blockchain, which our platform primarily uses, the average block 
    time is approximately 13-15 seconds. However, this can vary due to network congestion and other factors. It's important to note that 
    while blockchain transactions offer enhanced security and transparency, they might not be as instant as traditional digital transactions. 
    For more detailed and up-to-date information on Ethereum block times, please visit the [Ethereum website](https://ethereum.org).`
  },
  {
    question: 'Is There Customer Support Available?',
    answer: 'Yes, customer support is usually available via email, chat, or phone, with varying response times...'
  },
  {
    question: 'What is Blockchain and How Does it Work in This Marketplace?',
    answer: 'Blockchain is a decentralized ledger technology that records transactions across many computers...'
  },
  {
    question: 'How Does Blockchain Technology Make Transactions Trust-less?',
    answer: 'Blockchain eliminates the need for intermediaries, allowing transactions to be verified collaboratively...'
  },
  {
    question: 'What Are Smart Contracts and How Are They Used in the Marketplace?',
    answer: 'Smart contracts are self-executing contracts with the terms written into code, automating and securing transactions...'
  },
  {
    question: 'Is Trading on a Blockchain-based Marketplace Secure?',
    answer: 'Yes, blockchain encryption and consensus mechanisms make transactions highly secure and tamper-resistant...'
  },
  {
    question: 'Can I Use Fiat Currency (e.g., USD, Euro) in This Marketplace?',
    answer: 'It depends on the marketplace design. Some accept fiat currencies, others only cryptocurrencies, or both...'
  },
  {
    question: 'What Are the Fees for Using the Marketplace?',
    answer: 'Fees vary and may include transaction fees, listing fees, or other charges related to the use of the marketplace...'
  },
  {
    question: 'How Do I Set Up an Account to Start Trading?',
    answer: 'Setting up an account typically involves registering, creating a digital wallet, and following specific platform guidelines...'
  },
  {
    question: 'What Happens if There is a Dispute in a Transaction?',
    answer: 'Most marketplaces have a dispute resolution process, often involving smart contract mechanisms for fair outcomes...'
  },

  {
    question: 'What Types of Products or Services Can Be Traded on This Marketplace?',
    answer: 'The marketplace may support a wide range of products or services, but specific restrictions may apply...'
  },
  {
    question: 'How Does the Marketplace Handle Privacy and Data Protection?',
    answer: 'Blockchain transactions are secure, but the marketplace also implements additional privacy and data protection measures...'
  },
  {
    question: 'Can I Access the Marketplace From Any Country?',
    answer: 'Access may vary depending on local laws and regulations regarding blockchain and cryptocurrency use...'
  },
  {
    question: 'What Happens if I Lose My Private Keys?',
    answer: 'Losing private keys can mean losing access to your account. It\'s crucial to securely store and back up your keys...'
  },
  {
    question: 'Are There Any Educational Resources for Beginners?',
    answer: 'Many marketplaces provide tutorials, guides, and customer education programs to help new users...'
  }
]);

  </script>
  
  <style scoped>

  </style>
  