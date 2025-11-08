<script setup lang="ts">
// Define your script setup here
</script>

<template>
    <div>
        <div class="text-h5 text-weight-medium">How to read a contract</div>
        <div class="text-body2">Let's break down how contracts on the blockchain support transactions and also explain the benefits and nuances of using this approach compared to centralized systems. While this technology offers enhanced security, transparency, and direct peer-to-peer interactions, it also introduces new concepts such as gas fees and digital wallets. These nuances require a level of user understanding and acceptance, but in return, they offer a more decentralized, secure, and user-empowered system compared to centralized alternatives.</div>
        <div class="text-h6 q-mt-xl">Role of the contract in transactions</div>
            <ol>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Direct peer-to-peer transactions:</span> This contract facilitates direct transactions between parties (like buyers and sellers) without the need for a central authority or intermediary. Think of it as a digital marketplace where you can buy and sell unique digital items directly with others.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Trust and security:</span> The contract ensures that all transactions are secure and fair. It's like having an impartial digital referee who ensures that the rules are followed. If a product is sold, the buyer gets the item, and the seller gets the payment, exactly as agreed.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Transparent and immutable record:</span> Every transaction is recorded on a blockchain, which is a kind of digital ledger. Once a transaction is recorded, it can't be altered or deleted, ensuring a transparent and reliable history of ownership and transactions.</li>
                <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Automated enforcement of rules:</span> The contract automatically enforces the terms of a sale, such as price and conditions, without human intervention. This automation reduces errors and biases, ensuring that the agreed-upon terms are strictly followed.</li>
            </ol>
        <div class="text-h6 q-mt-xl">Advantages over centralized technology</div>
          <ol>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Elimination of middlemen:</span> By facilitating direct interactions between parties, the contract eliminates the need for middlemen, which can reduce costs and increase efficiency.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Increased security and reduced fraud:</span> The decentralized nature of the technology makes it more secure against fraud and hacking, as there's no single point of failure.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Empowerment of users:</span> Users have more control over their transactions and data, as opposed to relying on a central authority. This decentralization can enhance user trust and engagement.</li>
          </ol>
        <div class="text-h6 q-mt-xl">Nuances of transactions on the blockchain</div>
          <ol>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Gas fees:</span> Transactions require 'gas fees,' which are like transaction fees in traditional systems. These fees can fluctuate and might add an additional cost to transactions.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Deposits to a wallet:</span> Users need to deposit funds into a digital wallet to participate. This is similar to loading money onto a prepaid card but in a digital format.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Limited control for service providers:</span> As a service provider, your control over transactions is limited once the contract is deployed. The rules set in the contract are immutable, meaning they can't be changed without creating a new contract.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Need for user awareness:</span> Users must be aware of how to use digital wallets and understand the concept of gas fees, which can be a learning curve compared to traditional systems.</li>
              <li class="q-mx-xl q-py-sm"><span class="text-weight-medium">Reliance on network conditions:</span> The performance and cost of transactions can depend on the broader network's condition, which can sometimes lead to delays or higher fees.</li>
          </ol>
    </div>
  </template>
    
  <style scoped>
  ul {
  list-style-type: disc; /* or 'none' if you don't want any bullet points */
  padding-left: 20px; /* Adjust the value as needed */
}

li {
  list-style-position: outside; /* Or 'outside', depending on preference */
}

ol {
  list-style-type: decimal; /* This will ensure numbers are used */
  padding-left: 20px; /* Add some left padding to make sure numbers are visible */
}

  </style>
  